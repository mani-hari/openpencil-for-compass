import { spawn } from 'node:child_process';
import { resolveGeminiCli } from './resolve-gemini-cli';
import { serverLog } from './server-logger';

type ThinkingMode = 'adaptive' | 'disabled' | 'enabled';
type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';

export interface GeminiExecOptions {
  model?: string;
  systemPrompt?: string;
  thinkingMode?: ThinkingMode;
  thinkingBudgetTokens?: number;
  effort?: ThinkingEffort;
  timeoutMs?: number;
}

interface GeminiCliResult {
  text?: string;
  error?: string;
}

const DEFAULT_GEMINI_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Allowlist-based env filter for Gemini CLI subprocess.
 * Passes through safe system vars and Google/Gemini-specific prefixes.
 */
const GEMINI_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'TERM',
  'LANG',
  'SHELL',
  'TMPDIR',
  // Windows-essential
  'SYSTEMROOT',
  'COMSPEC',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PATHEXT',
  'SYSTEMDRIVE',
  'TEMP',
  'TMP',
  'HOMEDRIVE',
  'HOMEPATH',
]);

function filterGeminiEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (
      GEMINI_ENV_ALLOWLIST.has(k) ||
      k.startsWith('GOOGLE_') ||
      k.startsWith('GEMINI_') ||
      k.startsWith('GCLOUD_')
    ) {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Run Gemini CLI in non-interactive mode with JSON output.
 * Passes prompt via stdin to avoid command-line length limits.
 * The CLI handles its own authentication (OAuth or API key).
 */
export async function runGeminiExec(
  userPrompt: string,
  options: GeminiExecOptions = {},
): Promise<GeminiCliResult> {
  const binPath = resolveGeminiCli();
  if (!binPath) {
    return { error: 'Gemini CLI not found. Install it first.' };
  }

  const prompt = buildPrompt(options.systemPrompt, userPrompt);

  // Pass prompt as -p argument, not via stdin. The previous approach of
  // `-p ' '` (literal space) + prompt piped via stdin caused Gemini CLI to
  // treat ' ' as the prompt and return an empty response. Prompts up to
  // ARG_MAX (~1MB on macOS/Linux) fit comfortably as an argument.
  //
  // Also: no --approval-mode here. `plan` mode makes the CLI emit a plan
  // of actions instead of the requested content, which blows up the JSON
  // parse downstream.
  const args: string[] = ['-o', 'json'];
  if (options.model) args.push('-m', options.model);
  args.push('-p', prompt);

  serverLog.info(
    `[gemini-exec] invoking ${binPath} model=${options.model ?? 'default'} promptChars=${prompt.length}`,
  );

  try {
    const result = await executeGeminiCommand(
      binPath,
      args,
      options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS,
    );
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Gemini execution failed' };
  }
}

/**
 * Stream Gemini CLI output in real-time using `stream-json` format.
 * Passes prompt via stdin. Yields text deltas as they arrive.
 */
export function streamGeminiExec(
  userPrompt: string,
  options: GeminiExecOptions = {},
): {
  stream: AsyncGenerator<{ type: 'text' | 'error' | 'done'; content: string }>;
  kill: () => void;
} {
  const binPath = resolveGeminiCli();
  if (!binPath) {
    return {
      stream: (async function* () {
        yield { type: 'error' as const, content: 'Gemini CLI not found.' };
      })(),
      kill: () => {},
    };
  }

  const prompt = buildPrompt(options.systemPrompt, userPrompt);

  // Same rationale as runGeminiExec above: prompt as -p argument, no
  // --approval-mode, no stdin. Stream-json is what the CLI emits in
  // non-interactive mode when `-o stream-json` is specified.
  const args: string[] = ['-o', 'stream-json'];
  if (options.model) args.push('-m', options.model);
  args.push('-p', prompt);

  serverLog.info(
    `[gemini-stream] invoking ${binPath} model=${options.model ?? 'default'} promptChars=${prompt.length}`,
  );

  const child = spawn(binPath, args, {
    env: filterGeminiEnv(process.env as Record<string, string | undefined>),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(process.platform === 'win32' && { shell: true }),
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  async function* generateStream(): AsyncGenerator<{
    type: 'text' | 'error' | 'done';
    content: string;
  }> {
    let buffer = '';
    let stderrBuffer = '';
    let totalStdoutChars = 0;
    let emittedTextChars = 0;
    let rawStdoutForFallback = '';

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf-8');
    });

    try {
      for await (const chunk of child.stdout!) {
        const text = chunk.toString('utf-8');
        totalStdoutChars += text.length;
        rawStdoutForFallback += text;
        buffer += text;
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) {
            const event = parseStreamJsonLine(line);
            if (event) {
              if (event.type === 'text') emittedTextChars += event.content.length;
              yield event;
            }
          }
          idx = buffer.indexOf('\n');
        }
      }

      // Flush remaining buffer
      const tail = buffer.trim();
      if (tail) {
        const event = parseStreamJsonLine(tail);
        if (event) {
          if (event.type === 'text') emittedTextChars += event.content.length;
          yield event;
        }
      }

      serverLog.info(
        `[gemini-stream] finished stdoutChars=${totalStdoutChars} emittedTextChars=${emittedTextChars} stderrChars=${stderrBuffer.length}`,
      );
      if (stderrBuffer) {
        serverLog.info(`[gemini-stream] stderr head: ${stderrBuffer.slice(0, 500)}`);
      }

      // Fallback: if we got output from the CLI but emitted nothing as text
      // (unknown stream-json shape / older or newer CLI version), try to
      // recover a response from the raw stdout so the design generator sees
      // *something* rather than an opaque empty-response error.
      if (emittedTextChars === 0 && rawStdoutForFallback.trim()) {
        serverLog.info('[gemini-stream] no text events emitted, attempting raw fallback');
        const parsed = parseGeminiJsonOutput(rawStdoutForFallback);
        if (parsed?.response && parsed.response.trim().length > 0) {
          yield { type: 'text', content: parsed.response };
        } else if (parsed?.errorMessage) {
          yield { type: 'error', content: friendlyGeminiApiError(parsed.errorMessage) };
        } else {
          // Last-ditch: treat the raw stdout as text so the design parser at
          // least gets a chance at it.
          yield { type: 'text', content: rawStdoutForFallback };
        }
      }

      yield { type: 'done', content: '' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Stream error';
      yield { type: 'error', content: msg };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    stream: generateStream(),
    kill: () => {
      clearTimeout(timer);
      child.kill('SIGTERM');
    },
  };
}

function buildPrompt(systemPrompt: string | undefined, userPrompt: string): string {
  const userText = userPrompt.trim();
  if (!systemPrompt?.trim()) return userText;

  return [
    'You are a design generation assistant. Follow the guidelines below to produce the requested output.',
    '',
    '--- GUIDELINES ---',
    systemPrompt.trim(),
    '',
    '--- TASK ---',
    userText,
  ].join('\n');
}

async function executeGeminiCommand(
  binPath: string,
  args: string[],
  timeoutMs: number,
): Promise<GeminiCliResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      env: filterGeminiEnv(process.env as Record<string, string | undefined>),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(process.platform === 'win32' && { shell: true }),
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf-8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      // Always surface a preview of raw output to the server log so we can
      // diagnose "empty response" failures without guessing.
      serverLog.info(
        `[gemini-exec] exit=${code} stdoutChars=${stdoutBuffer.length} stderrChars=${stderrBuffer.length}`,
      );
      if (stdoutBuffer) {
        serverLog.info(`[gemini-exec] stdout head: ${stdoutBuffer.slice(0, 500)}`);
      }
      if (stderrBuffer) {
        serverLog.info(`[gemini-exec] stderr head: ${stderrBuffer.slice(0, 500)}`);
      }

      // Parse JSON output — Gemini CLI always outputs a JSON object at the end of stdout.
      // Error text / stack traces may appear before it.
      const parsed = parseGeminiJsonOutput(stdoutBuffer);

      if (parsed) {
        if (parsed.response && parsed.response.trim().length > 0) {
          resolve({ text: parsed.response });
          return;
        }
        if (parsed.errorMessage) {
          resolve({ error: friendlyGeminiApiError(parsed.errorMessage) });
          return;
        }
        // JSON was returned but `response` is empty and no errorMessage.
        // This usually means the model was blocked by a safety filter or
        // the CLI is in a mode (e.g. --approval-mode plan) that doesn't
        // produce free-form text. Fall through to raw-stdout fallback.
      }

      if (code !== 0) {
        // Extract meaningful error from stderr or stdout
        const errorMsg = extractGeminiError(stdoutBuffer, stderrBuffer);
        resolve({ error: errorMsg || `Gemini exited with code ${code ?? 'unknown'}.` });
        return;
      }

      // Fallback: if the CLI exited 0 but the JSON parse didn't yield a
      // response, surface whatever it did print. This covers "-o json"
      // output-format changes across CLI versions.
      const raw = stdoutBuffer.trim();
      if (!raw) {
        resolve({ error: 'Gemini returned no output. Check ~/.openpencil/logs/ for details.' });
        return;
      }
      // If stdout looks like JSON with an empty response, report that
      // specifically so the caller can distinguish from parse errors.
      if (parsed && parsed.response !== undefined && parsed.response.trim().length === 0) {
        resolve({
          error:
            'Gemini returned an empty text response. This usually means a safety filter or quota issue. See ~/.openpencil/logs/ for raw output.',
        });
        return;
      }
      resolve({ text: raw });
    });
  });
}

/**
 * Parse Gemini CLI JSON output.
 * The CLI may print error text before the final JSON object.
 * We search from the END of stdout for the last valid JSON block.
 */
function parseGeminiJsonOutput(raw: string): { response?: string; errorMessage?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Search backwards for the last top-level JSON object (starts with `{` at line beginning)
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;

    // Try to parse from this line to the end
    const candidate = lines.slice(i).join('\n').trim();
    try {
      const data = JSON.parse(candidate) as Record<string, unknown>;
      // Must have session_id to be a valid Gemini CLI response
      if (!data.session_id && !data.response && !data.error) continue;

      const response = typeof data.response === 'string' ? data.response : undefined;

      // error can be a string or an object { type, message, code }
      let errorMessage: string | undefined;
      if (data.error) {
        if (typeof data.error === 'string') {
          errorMessage = data.error;
        } else if (typeof data.error === 'object' && data.error !== null) {
          const errObj = data.error as Record<string, unknown>;
          errorMessage =
            typeof errObj.message === 'string' ? errObj.message : JSON.stringify(data.error);
        }
      }

      return { response, errorMessage };
    } catch {
      /* not valid JSON from this point */
    }
  }

  return null;
}

/** Extract a human-readable error from Gemini CLI stdout/stderr */
function extractGeminiError(stdout: string, stderr: string): string | null {
  // Look for quota errors
  const quotaMatch =
    stdout.match(/quota will reset after (\S+)/i) || stderr.match(/quota will reset after (\S+)/i);
  if (quotaMatch) {
    return `Gemini quota exhausted. Resets after ${quotaMatch[1]}.`;
  }

  // Look for TerminalQuotaError or other named errors
  const namedError = stdout.match(/(Terminal\w+Error|ApiError|AuthError):\s*(.+)/m);
  if (namedError) {
    return namedError[2].trim();
  }

  // Stderr fallback
  const stderrTrimmed = stderr.trim();
  if (stderrTrimmed) return stderrTrimmed;

  return null;
}

/** Map raw Gemini API errors to user-friendly messages */
function friendlyGeminiApiError(raw: string): string {
  if (/quota|exhausted|429|capacity/i.test(raw)) {
    const resetMatch = raw.match(/reset after (\S+)/i);
    return resetMatch
      ? `Gemini quota exhausted. Resets after ${resetMatch[1]}.`
      : 'Gemini quota exhausted. Please wait and try again.';
  }
  if (/401|unauthenticated|auth/i.test(raw)) {
    return 'Gemini auth expired. Run "gemini" in your terminal to re-authenticate.';
  }
  if (/\[object Object\]/.test(raw)) {
    return 'Gemini API error. Check your quota or try a different model.';
  }
  return raw;
}

function parseStreamJsonLine(
  line: string,
): { type: 'text' | 'error' | 'done'; content: string } | null {
  // Skip non-JSON lines (e.g. "Loaded cached credentials.")
  if (!line.startsWith('{')) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = typeof parsed.type === 'string' ? parsed.type : '';

  // Gemini CLI v0.1.x: {"type":"message","role":"assistant","content":"..."}
  if (type === 'message' && parsed.role === 'assistant') {
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    if (content) return { type: 'text', content };
  }

  // Gemini CLI v0.2.x+: {"type":"content","content":"..."} for streaming deltas
  if (type === 'content') {
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    if (content) return { type: 'text', content };
  }

  // Some builds emit {"type":"text","text":"..."}
  if (type === 'text') {
    const content =
      typeof parsed.text === 'string'
        ? parsed.text
        : typeof parsed.content === 'string'
          ? parsed.content
          : '';
    if (content) return { type: 'text', content };
  }

  // Some builds emit a single {"response":"..."} per line
  if (typeof parsed.response === 'string' && parsed.response.length > 0) {
    return { type: 'text', content: parsed.response };
  }

  if (type === 'result') {
    // Check for error in result event
    if (parsed.status === 'error' && parsed.error) {
      const errObj = parsed.error as Record<string, unknown>;
      const msg = typeof errObj.message === 'string' ? errObj.message : 'Unknown error';
      return { type: 'error', content: friendlyGeminiApiError(msg) };
    }
    // Successful result with embedded response field (newer CLI versions).
    if (typeof parsed.response === 'string' && parsed.response.length > 0) {
      return { type: 'text', content: parsed.response };
    }
    return null;
  }

  if (type === 'error') {
    const content = typeof parsed.message === 'string' ? parsed.message : 'Unknown error';
    return { type: 'error', content: friendlyGeminiApiError(content) };
  }

  return null;
}

import type { SessionNotification } from '@agentclientprotocol/sdk';

/** Convert an ACP session/update notification to an OpenPencil SSE event string. */
export function acpUpdateToSSE(notification: SessionNotification): string | null {
  const update = notification.update;
  if (!update) return null;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content;
      if (content && 'text' in content && content.type === 'text') {
        return formatSSE('text', { type: 'text', content: content.text });
      }
      return null;
    }

    case 'tool_call': {
      // ACP tool calls are display-only — the agent executes them via MCP.
      // level: 'orchestrate' makes AgentToolExecutor skip execution.
      return formatSSE('tool_call', {
        type: 'tool_call',
        id: update.toolCallId,
        name: update.title ?? 'unknown',
        args: update.rawInput ?? {},
        level: 'orchestrate',
      });
    }

    case 'tool_call_update': {
      if (update.status === 'completed' || update.status === 'failed') {
        return formatSSE('tool_result', {
          type: 'tool_result',
          id: update.toolCallId,
          name: '',
          result: {
            success: update.status === 'completed',
            data: update.rawOutput,
          },
        });
      }
      return null;
    }

    default:
      return null;
  }
}

function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

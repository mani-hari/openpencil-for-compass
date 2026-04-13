# UX Compass ↔ OpenPencil Integration — OpenPencil mirror

> Mirror of the canonical spec maintained in the UX Compass repo at
> `docs/openpencil-integration.md`. This file holds **only** the contract
> surface OpenPencil implements. For the decision log and full context,
> see the UX Compass canonical doc.

**Contract version:** `v1.0.0`
**Last synced:** 2026-04-13

---

## Transport
Client-side `window.postMessage` between the UX Compass parent window
and the OpenPencil iframe (served at `http://localhost:3000/editor`).

## Origin allowlist
OpenPencil accepts `uxc:*` messages only from origins in the comma-separated
list `VITE_UXC_ORIGIN` (default `http://localhost:3002`). Prod: include the
UX Compass GCP App Engine domain.

## Message contract

### UX Compass → OpenPencil

```ts
// Handshake probe sent by the parent to check the iframe is ready.
{ type: 'uxc:hello', version: 1 }

// Main generation request. One active request at a time — a new request
// aborts any in-flight generation.
{
  type: 'uxc:generate',
  version: 1,
  requestId: string,
  prompt: string,                 // full text prompt (buildStitchPrompt output)
  blueprint?: ScreenDefinition,   // optional structured screen spec
  blueprintDigest?: string,       // optional flat string summary
  context?: {
    product: 'Cloud SQL' | 'AlloyDB' | 'BigQuery' | 'Datastream',
    page: string,
    route: string,
    surface: 'console' | 'ide',
    feature: string,
    interventionFocus: string,
  }
}

// Explicit cancel. Optional — sending a new uxc:generate also cancels.
{ type: 'uxc:cancel', requestId: string }
```

### OpenPencil → UX Compass

```ts
// Sent once on mount after the editor is ready to accept uxc:generate.
{ type: 'uxc:ready', version: 1 }

// Sent in response to uxc:hello.
{ type: 'uxc:pong', version: 1 }

// Acknowledges a specific uxc:generate request.
{ type: 'uxc:ack', requestId: string }

// Phase + progress updates during generation.
{ type: 'uxc:status', requestId: string, phase: 'planning' | 'generating' | 'refining' | 'done', progress: number /* 0..1 */ }

// Fires whenever the AI adds a node to the canvas.
{ type: 'uxc:node-added', requestId: string, nodeId: string, nodeType: string }

// Generation finished successfully.
{ type: 'uxc:complete', requestId: string, summary: { nodeCount: number, durationMs: number } }

// Generation failed (recoverable=true means UXC can retry without user action,
// e.g. transient network; recoverable=false means user must fix config, e.g.
// no AI provider configured).
{ type: 'uxc:error', requestId: string, message: string, recoverable: boolean, code?: 'no-provider' | 'aborted' | 'timeout' | 'unknown' }
```

## AI provider model

OpenPencil uses the **local user's own AI provider keys**, stored in browser
localStorage via `AgentSettingsDialog` (Anthropic API key, Gemini key,
Claude CLI OAuth, etc.). UX Compass does not supply keys.

If no provider is configured when a `uxc:generate` arrives, OpenPencil
responds with:

```ts
{ type: 'uxc:error', requestId, message: 'No AI provider configured. Open Agent Settings in the iframe to configure a provider.', recoverable: false, code: 'no-provider' }
```

UX Compass should surface this clearly in its UI (not just a silent
blank canvas).

## Behavior rules

1. **Single in-flight request.** Arrival of `uxc:generate` while another
   is running aborts the prior one; only the newest `requestId` remains
   authoritative.
2. **Handshake.** OpenPencil posts `uxc:ready` to `window.parent` on
   editor mount. UX Compass may send `uxc:hello` at any time; OpenPencil
   replies with `uxc:pong`.
3. **Origin validation.** Every incoming message must have
   `event.origin` in the `VITE_UXC_ORIGIN` allowlist, else it's
   silently ignored.
4. **No-op when not iframed.** If `window.parent === window`, the bridge
   disables itself and emits no events.

## Environment variables (OpenPencil side)

| Var                 | Default                  | Purpose                                     |
|---------------------|--------------------------|---------------------------------------------|
| `VITE_UXC_ORIGIN`   | `http://localhost:3002`  | Comma-separated origin allowlist for UXC    |

## Implementation pointers (OpenPencil)

- `apps/web/src/lib/uxc-messages.ts` — TypeScript contract types (this file's types)
- `apps/web/src/hooks/use-uxc-bridge.ts` — listener, AI hookup, progress emitter
- `apps/web/src/routes/editor.tsx` — calls `useUxcBridge()`
- `test-uxc-harness.html` — standalone HTML to simulate UXC locally

## Change proposal workflow

For any contract change, post a `PROPOSAL [OP → UXC]: ...` block to the
user. The UX Compass canonical doc is the source of truth; this file is
updated after a change is accepted there. Bump version if breaking.

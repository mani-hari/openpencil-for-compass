/**
 * UX Compass ↔ OpenPencil bridge hook.
 *
 * Listens for `uxc:*` postMessage events from a parent window (UX Compass),
 * feeds incoming prompts into the existing AI design-generation pipeline,
 * and emits progress events back to `window.parent`.
 *
 * Contract: see apps/web/src/lib/uxc-messages.ts and docs/uxc-integration.md.
 */
import { useEffect } from 'react'
import { flattenNodes } from '@zseven-w/pen-core'
import type { PenNode } from '@/types/pen'
import type { AIProviderConfig } from '@/types/agent-settings'
import {
  isUxcInbound,
  UXC_CONTRACT_VERSION,
  type UxcOutboundMessage,
  type UxcGenerate,
  type UxcPhase,
} from '@/lib/uxc-messages'
import { useAIStore } from '@/stores/ai-store'
import { useAgentSettingsStore } from '@/stores/agent-settings-store'
import { useDocumentStore } from '@/stores/document-store'
import { submitToChat, hasChatSender } from '@/lib/chat-sender-registry'

function parseOriginAllowlist(): string[] {
  const raw = (import.meta.env.VITE_UXC_ORIGIN as string | undefined) ??
    'http://localhost:3002'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isProviderReady(): boolean {
  const state = useAgentSettingsStore.getState()
  const providerReady = (Object.values(state.providers) as AIProviderConfig[])
    .some((p) => p.isConnected)
  const builtinReady = state.builtinProviders.some(
    (p) => p.enabled && !!p.apiKey,
  )
  return providerReady || builtinReady
}

function nodeIdsFromDoc(doc: { children?: PenNode[]; pages?: Array<{ children: PenNode[] }> }): Set<string> {
  const roots = doc.pages
    ? doc.pages.flatMap((p) => p.children)
    : (doc.children ?? [])
  return new Set(flattenNodes(roots).map((n) => n.id))
}

function typeOfNode(doc: { children?: PenNode[]; pages?: Array<{ children: PenNode[] }> }, id: string): string {
  const roots = doc.pages
    ? doc.pages.flatMap((p) => p.children)
    : (doc.children ?? [])
  const match = flattenNodes(roots).find((n) => n.id === id)
  return (match?.type as string | undefined) ?? 'unknown'
}

export function useUxcBridge(): void {
  useEffect(() => {
    // No-op unless actually iframed.
    if (typeof window === 'undefined' || window.parent === window) return

    const allowlist = parseOriginAllowlist()
    // Visible breadcrumb so we can verify the bridge is alive in DevTools.
    // eslint-disable-next-line no-console
    console.info('[uxc-bridge] mounted; allowlist =', allowlist)
    const activeRef: {
      requestId: string | null
      abort: AbortController | null
      startedAt: number
      startingDocIds: Set<string>
      unsubscribeDoc: (() => void) | null
    } = {
      requestId: null,
      abort: null,
      startedAt: 0,
      startingDocIds: new Set(),
      unsubscribeDoc: null,
    }

    const post = (msg: UxcOutboundMessage, targetOrigin: string = '*') => {
      try {
        window.parent.postMessage(msg, targetOrigin)
        // eslint-disable-next-line no-console
        console.info('[uxc-bridge] → outbound', targetOrigin, msg)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[uxc-bridge] post failed', err)
      }
    }

    const emitStatus = (requestId: string, phase: UxcPhase, progress: number) =>
      post({ type: 'uxc:status', requestId, phase, progress })

    const abortActive = (reason: 'superseded' | 'cancelled') => {
      const { requestId, abort, unsubscribeDoc } = activeRef
      if (unsubscribeDoc) unsubscribeDoc()
      activeRef.unsubscribeDoc = null
      if (abort && !abort.signal.aborted) abort.abort()
      if (requestId) {
        post({
          type: 'uxc:error',
          requestId,
          message:
            reason === 'superseded'
              ? 'Request superseded by a newer uxc:generate'
              : 'Cancelled',
          recoverable: reason === 'superseded',
          code: 'aborted',
        })
      }
      activeRef.requestId = null
      activeRef.abort = null
    }

    const startGeneration = async (msg: UxcGenerate) => {
      // Supersede any in-flight generation.
      if (activeRef.requestId) abortActive('superseded')

      if (!isProviderReady()) {
        post({
          type: 'uxc:error',
          requestId: msg.requestId,
          message:
            'No AI provider configured. Open Agent Settings inside the iframe to add a key.',
          recoverable: false,
          code: 'no-provider',
        })
        return
      }

      const abort = new AbortController()
      activeRef.requestId = msg.requestId
      activeRef.abort = abort
      activeRef.startedAt = Date.now()

      // Baseline doc ids so we only emit uxc:node-added for nodes added
      // during this generation.
      const initialDoc = useDocumentStore.getState().document
      activeRef.startingDocIds = nodeIdsFromDoc(initialDoc)

      // Subscribe to document additions and rebroadcast as uxc:node-added.
      const emitted = new Set<string>(activeRef.startingDocIds)
      activeRef.unsubscribeDoc = useDocumentStore.subscribe((state) => {
        const ids = nodeIdsFromDoc(state.document)
        for (const id of ids) {
          if (!emitted.has(id)) {
            emitted.add(id)
            post({
              type: 'uxc:node-added',
              requestId: msg.requestId,
              nodeId: id,
              nodeType: typeOfNode(state.document, id),
            })
          }
        }
      })

      post({ type: 'uxc:ack', requestId: msg.requestId })
      emitStatus(msg.requestId, 'planning', 0.05)

      // Build the prompt. If caller supplied a blueprint digest, append it
      // as additional grounding for the generator. The prompt itself is
      // used verbatim (it's already rich — see buildStitchPrompt).
      const fullPrompt = msg.blueprintDigest
        ? `${msg.prompt}\n\n---\nBLUEPRINT DIGEST:\n${msg.blueprintDigest}`
        : msg.prompt

      // Route through the chat panel's submit pipeline so the prompt
      // appears as a visible user message and flows through the same code
      // path as a manual Enter press. The chat handler reads the current
      // model/provider from ai-store on its own; nothing to wire here.
      if (!hasChatSender()) {
        post({
          type: 'uxc:error',
          requestId: msg.requestId,
          message:
            'Chat panel not mounted yet — the bridge could not hand off the prompt. Try reopening the iframe.',
          recoverable: true,
          code: 'unknown',
        })
        if (activeRef.unsubscribeDoc) activeRef.unsubscribeDoc()
        activeRef.unsubscribeDoc = null
        activeRef.requestId = null
        activeRef.abort = null
        return
      }

      // Register the abort controller so the chat UI's cancel button also
      // aborts an uxc-originated run.
      useAIStore.getState().setAbortController(abort)
      emitStatus(msg.requestId, 'generating', 0.2)

      // Hand off to the chat pipeline. handleSend adds a user message,
      // sets streaming, and runs the same path as manual submission.
      submitToChat(fullPrompt)

      // Observe ai-store.streaming to detect completion. The chat handler
      // flips it back to false on success, error, or abort.
      const completionUnsub = useAIStore.subscribe((state, prev) => {
        if (activeRef.requestId !== msg.requestId) return
        if (prev.isStreaming && !state.isStreaming) {
          completionUnsub()
          // Decide success vs error by inspecting the last assistant
          // message; if it ends with an error-looking string we surface it.
          const last = state.messages[state.messages.length - 1]
          const looksError =
            !!last?.content &&
            /error|failed|exited with code/i.test(last.content) &&
            last.content.length < 400
          const addedCount = Math.max(
            0,
            nodeIdsFromDoc(useDocumentStore.getState().document).size -
              activeRef.startingDocIds.size,
          )
          if (abort.signal.aborted) {
            post({
              type: 'uxc:error',
              requestId: msg.requestId,
              message: 'Generation aborted',
              recoverable: true,
              code: 'aborted',
            })
          } else if (looksError && addedCount === 0) {
            post({
              type: 'uxc:error',
              requestId: msg.requestId,
              message: last!.content,
              recoverable: true,
              code: 'unknown',
            })
          } else {
            emitStatus(msg.requestId, 'refining', 0.95)
            post({
              type: 'uxc:complete',
              requestId: msg.requestId,
              summary: {
                nodeCount: addedCount,
                durationMs: Date.now() - activeRef.startedAt,
              },
            })
            emitStatus(msg.requestId, 'done', 1)
          }
          if (activeRef.unsubscribeDoc) activeRef.unsubscribeDoc()
          activeRef.unsubscribeDoc = null
          activeRef.requestId = null
          activeRef.abort = null
        }
      })
    }

    const onMessage = (event: MessageEvent) => {
      // Only log uxc:* traffic so we don't spam with Vite HMR / devtools noise.
      const looksLikeUxc =
        event.data &&
        typeof event.data === 'object' &&
        typeof (event.data as { type?: unknown }).type === 'string' &&
        ((event.data as { type: string }).type).startsWith('uxc:')
      if (looksLikeUxc) {
        // eslint-disable-next-line no-console
        console.info('[uxc-bridge] ← inbound', event.origin, event.data)
      }
      if (!allowlist.includes(event.origin)) {
        if (looksLikeUxc) {
          // eslint-disable-next-line no-console
          console.warn(
            '[uxc-bridge] DROPPED: origin',
            event.origin,
            'not in allowlist',
            allowlist,
          )
        }
        return
      }
      if (!isUxcInbound(event.data)) {
        if (looksLikeUxc) {
          // eslint-disable-next-line no-console
          console.warn('[uxc-bridge] DROPPED: failed isUxcInbound', event.data)
        }
        return
      }

      const msg = event.data
      switch (msg.type) {
        case 'uxc:hello':
          post({ type: 'uxc:pong', version: UXC_CONTRACT_VERSION })
          return
        case 'uxc:cancel':
          if (activeRef.requestId === msg.requestId) abortActive('cancelled')
          return
        case 'uxc:generate':
          void startGeneration(msg)
          return
      }
    }

    window.addEventListener('message', onMessage)
    // Announce readiness to all allowlisted origins.
    for (const origin of allowlist) {
      post({ type: 'uxc:ready', version: UXC_CONTRACT_VERSION }, origin)
    }

    return () => {
      window.removeEventListener('message', onMessage)
      if (activeRef.abort && !activeRef.abort.signal.aborted) {
        activeRef.abort.abort()
      }
      if (activeRef.unsubscribeDoc) activeRef.unsubscribeDoc()
    }
  }, [])
}

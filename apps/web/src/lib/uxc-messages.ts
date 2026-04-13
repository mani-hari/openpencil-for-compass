/**
 * Type contract for the UX Compass ↔ OpenPencil postMessage bridge.
 *
 * This file MUST stay in sync with the `lib/openpencil-messages.ts` file
 * in the UX Compass repo. See docs/uxc-integration.md for the canonical
 * contract and versioning rules.
 */

export const UXC_CONTRACT_VERSION = 1 as const

// ---------- UX Compass → OpenPencil ----------

export interface UxcHello {
  type: 'uxc:hello'
  version: 1
}

export interface UxcGenerate {
  type: 'uxc:generate'
  version: 1
  requestId: string
  prompt: string
  /** Optional structured screen spec (engine/blueprintSchema.ts shape). */
  blueprint?: unknown
  /** Optional flattened string summary of the blueprint. */
  blueprintDigest?: string
  context?: {
    product?: 'Cloud SQL' | 'AlloyDB' | 'BigQuery' | 'Datastream' | string
    page?: string
    route?: string
    surface?: 'console' | 'ide'
    feature?: string
    interventionFocus?: string
  }
}

export interface UxcCancel {
  type: 'uxc:cancel'
  requestId: string
}

export type UxcInboundMessage = UxcHello | UxcGenerate | UxcCancel

// ---------- OpenPencil → UX Compass ----------

export interface UxcReady {
  type: 'uxc:ready'
  version: 1
}

export interface UxcPong {
  type: 'uxc:pong'
  version: 1
}

export interface UxcAck {
  type: 'uxc:ack'
  requestId: string
}

export type UxcPhase = 'planning' | 'generating' | 'refining' | 'done'

export interface UxcStatus {
  type: 'uxc:status'
  requestId: string
  phase: UxcPhase
  /** 0..1 */
  progress: number
}

export interface UxcNodeAdded {
  type: 'uxc:node-added'
  requestId: string
  nodeId: string
  nodeType: string
}

export interface UxcComplete {
  type: 'uxc:complete'
  requestId: string
  summary: {
    nodeCount: number
    durationMs: number
  }
}

export type UxcErrorCode = 'no-provider' | 'aborted' | 'timeout' | 'unknown'

export interface UxcError {
  type: 'uxc:error'
  requestId: string
  message: string
  recoverable: boolean
  code?: UxcErrorCode
}

export type UxcOutboundMessage =
  | UxcReady
  | UxcPong
  | UxcAck
  | UxcStatus
  | UxcNodeAdded
  | UxcComplete
  | UxcError

// ---------- Type guards ----------

export function isUxcInbound(m: unknown): m is UxcInboundMessage {
  if (!m || typeof m !== 'object') return false
  const t = (m as { type?: unknown }).type
  return t === 'uxc:hello' || t === 'uxc:generate' || t === 'uxc:cancel'
}

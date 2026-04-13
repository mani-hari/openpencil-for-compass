/**
 * Module-level registry so non-React code (e.g. the UXC bridge hook) can
 * invoke the same submit pipeline that the AI chat panel uses when the user
 * types a prompt and presses Enter.
 *
 * The chat panel registers its `handleSend(text)` callback on mount and
 * unregisters on unmount. External callers use `submitToChat(text)`.
 */

export type ChatSender = (text: string) => Promise<void> | void

let registered: ChatSender | null = null

export function registerChatSender(fn: ChatSender): () => void {
  registered = fn
  return () => {
    if (registered === fn) registered = null
  }
}

export function hasChatSender(): boolean {
  return registered !== null
}

export function submitToChat(text: string): boolean {
  if (!registered) return false
  try {
    void registered(text)
    return true
  } catch {
    return false
  }
}

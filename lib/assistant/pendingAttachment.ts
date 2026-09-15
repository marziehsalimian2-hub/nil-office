import "server-only";

/**
 * Live-tested gap (2026-09-15): a photo/PDF was originally scoped to the
 * single turn it arrived in (orchestrator.ts's `attachment` param). That
 * works for "send photo -> immediate proposal -> tap confirm" (the
 * confirm button never goes through runChatTurn again — the file's
 * bytes are already baked into the pending action's payload by then).
 * It breaks the moment the model asks ONE clarifying question first (a
 * real, observed, and correct behavior — spec §36 wants exactly this
 * when sender/company is ambiguous): the user's answer arrives as a
 * NEW, separate, attachment-less runChatTurn call, so by the time the
 * model actually calls REGISTER_INCOMING_LETTER a few messages later,
 * there is no attachment left to read.
 *
 * Fix: remember the most recent attachment per conversation, in-process
 * memory only (this deployment is a single persistent PM2/Next process,
 * not serverless — confirmed this session) — never written to the
 * database, matching spec §80's temporary-vs-archived distinction: this
 * is purely transient working state, not the official attachment (that
 * only exists once createAndRegisterIncomingCore actually uploads it).
 * Cleared as soon as a write-proposal actually consumes it, on a fresh
 * attachment arriving, or after TTL_MS of inactivity — whichever comes
 * first.
 */

type StoredAttachment = { kind: "image" | "document"; mediaType: string; data: string; expiresAt: number };

const TTL_MS = 20 * 60 * 1000; // long enough for a multi-message clarification dialog, short enough not to linger

const store = new Map<string, StoredAttachment>();

export function rememberPendingAttachment(conversationId: string, attachment: { kind: "image" | "document"; mediaType: string; data: string }): void {
  store.set(conversationId, { ...attachment, expiresAt: Date.now() + TTL_MS });
}

export function getPendingAttachment(conversationId: string): { kind: "image" | "document"; mediaType: string; data: string } | null {
  const entry = store.get(conversationId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(conversationId);
    return null;
  }
  return entry;
}

export function clearPendingAttachment(conversationId: string): void {
  store.delete(conversationId);
}

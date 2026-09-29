import "server-only";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Public tracking code (spec §16/§32) — stored in PLAINTEXT, a
 * deliberate divergence from lib/trade/token.ts's hash-only model.
 * Trade Portal's token rides in a clicked URL, so hashing-at-rest is
 * pure defense-in-depth against a DB leak exposing usable links. This
 * code is read off a screen and typed into a bot menu — it must be
 * shown back to the sender at least once (spec §16) and looked up by
 * exact value, so hashing buys nothing a sufficiently long random value
 * doesn't already provide. Brute-force guessing is defended by
 * per-requester rate limiting on lookup attempts (migration 0099's
 * external_intake_get_status), not by secrecy of storage.
 *
 * Alphabet excludes visually ambiguous characters (0/O, 1/I/L) since a
 * human retypes this from a screen. 10 chars from a 32-symbol alphabet
 * = 50 bits of entropy — combined with rate-limited lookups, this is
 * comfortably non-guessable (spec §32's actual requirement).
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateTrackingCode(): string {
  const bytes = randomBytes(10);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `NIL-T-${body}`;
}

/** Deterministic id for a to-be-uploaded external-correspondence document's storage path — mirrors lib/trade/token.ts's generateDocumentId(). */
export function generateExternalDocumentId(): string {
  return randomUUID();
}

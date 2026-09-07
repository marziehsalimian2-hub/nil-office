import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";

/**
 * 256-bit cryptographically secure random token for a buyer link. Only
 * ever held in memory / shown once to the admin — never written to the
 * database. base64url keeps it URL-safe with no encoding needed.
 */
export function generateBuyerToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest — the only form of the token that is ever stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Deterministic id for a to-be-uploaded trade document's storage path. */
export function generateDocumentId(): string {
  return randomUUID();
}

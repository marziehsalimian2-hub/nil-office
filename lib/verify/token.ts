import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Public verification token: 256 bits from the OS CSPRNG, base64url (43 chars). It lives ONLY inside the QR URL printed in the PDF —
 * the database stores nothing but its SHA-256, so a database leak cannot reveal a single verification link. Never derived from a
 * database id, a document id, a document number or any sequence.
 */
export function generateVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export const hashVerifyToken = (token: string) => sha256Hex(token);

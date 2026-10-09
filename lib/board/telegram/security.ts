import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Board bot security primitives (pure Node, unit-tested).
 * - The webhook secret header and the cron secret are compared in constant time.
 * - A link token is 32 random bytes, base64url (43 chars — fits Telegram's /start deep-link payload: [A-Za-z0-9_-], max 64).
 *   Only its SHA-256 is stored (board_link_tokens.token_hash); the raw token exists only inside the link shown once to the secretary.
 */

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyBoardWebhookSecret(header: string | null): boolean {
  const expected = process.env.BOARD_TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[board-telegram] BOARD_TELEGRAM_WEBHOOK_SECRET is not configured");
    return false;
  }
  return safeEqual(header, expected);
}

export function verifyBoardCronSecret(header: string | null): boolean {
  const expected = process.env.BOARD_CRON_SECRET;
  if (!expected || expected.length < 24) {
    console.error("[board-cron] BOARD_CRON_SECRET is not configured (min 24 chars)");
    return false;
  }
  return safeEqual(header, expected);
}

export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** «https://t.me/<bot>?start=<token>», or null when the bot username is not configured / invalid. */
export function buildLinkUrl(token: string, botUsername = process.env.BOARD_TELEGRAM_BOT_USERNAME): string | null {
  const u = (botUsername ?? "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(u) || !LINK_TOKEN_RE.test(token)) return null;
  return `https://t.me/${u}?start=${token}`;
}

/** The /start payload, if the message is exactly «/start <token>». */
export function parseStartToken(text: string | undefined): string | null {
  const m = /^\/start\s+([A-Za-z0-9_-]{43})\s*$/.exec(text ?? "");
  return m ? m[1] : null;
}

export function isPrivateChat(chatType: string | undefined): boolean {
  return chatType === "private";
}

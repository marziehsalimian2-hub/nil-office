import "server-only";

/**
 * Verifies Telegram's own webhook-secret header (spec §4). Telegram
 * echoes back whatever secret_token was registered with setWebhook on
 * every single update, in the `X-Telegram-Bot-Api-Secret-Token` header —
 * this is the ONLY thing that proves a request genuinely came from
 * Telegram (there is no request signature to verify otherwise). Checked
 * before the body is even parsed.
 */
export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET is not configured");
    return false;
  }
  return headerValue === expected;
}

/**
 * Server-side allowlist (spec §1) — parsed from env on every check, not
 * cached at module load, so a redeploy after editing the env var takes
 * effect immediately. Never trust a Telegram username, only the numeric
 * user id Telegram itself reports as the update's sender.
 */
export function isAllowedTelegramUser(telegramUserId: number): boolean {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(String(telegramUserId));
}

/** Only private 1:1 chats are ever processed for business requests (spec §26/§27) — group/supergroup/channel updates are ignored entirely. */
export function isPrivateChat(chatType: string | undefined): boolean {
  return chatType === "private";
}

import "server-only";

/**
 * Verifies Telegram's own webhook-secret header, using
 * EXTERNAL_TELEGRAM_WEBHOOK_SECRET — a fully separate secret from the
 * internal bot's TELEGRAM_WEBHOOK_SECRET (spec §53/§54). Checked before
 * the body is even parsed.
 */
export function verifyExternalWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.EXTERNAL_TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[external-telegram] EXTERNAL_TELEGRAM_WEBHOOK_SECRET is not configured");
    return false;
  }
  return headerValue === expected;
}

/**
 * Only private 1:1 chats are ever processed — group/supergroup/channel
 * spam to the bot is ignored entirely. Unlike the internal bot, this
 * bot has NO allowlist of any kind by design (spec §0 — it is open to
 * the public); isAllowedTelegramUser-equivalent logic is deliberately
 * absent here, not an oversight.
 */
export function isPrivateChat(chatType: string | undefined): boolean {
  return chatType === "private";
}

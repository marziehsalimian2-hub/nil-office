import "server-only";

/**
 * Thin fetch-based wrapper around the Telegram Bot HTTP API for the
 * EXTERNAL correspondence bot — structurally mirrors
 * lib/assistant/telegram/bot.ts, but reads EXTERNAL_TELEGRAM_BOT_TOKEN,
 * a fully separate env var/token from the internal bot's
 * TELEGRAM_BOT_TOKEN (spec §54 — no shared trust boundary). Read fresh
 * from process.env on every call, never module-cached, never logged.
 */

function botToken(): string {
  const token = process.env.EXTERNAL_TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("EXTERNAL_TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    console.error(`[external-telegram] ${method} failed`, json ?? res.status);
  }
  return json;
}

export type InlineKeyboardButton = { text: string; callback_data: string };

export async function sendMessage(chatId: number, text: string, inlineKeyboard?: InlineKeyboardButton[][]): Promise<{ message_id: number } | null> {
  const result = (await call("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined,
  })) as { ok: boolean; result?: { message_id: number } } | null;
  return result?.result ?? null;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export async function clearInlineKeyboard(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

/** Resolves a Telegram file_id (an uploaded document/photo) to a downloadable URL. Caller fetches the bytes itself. */
export async function getFileDownloadUrl(fileId: string): Promise<string | null> {
  const result = (await call("getFile", { file_id: fileId })) as { ok: boolean; result?: { file_path: string } } | null;
  const filePath = result?.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${botToken()}/${filePath}`;
}

/** Sends a document (used by a later phase's reply-delivery feature) — multipart upload, no SDK dependency. */
export async function sendDocument(chatId: number, buffer: Buffer, filename: string, caption?: string): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  if (caption) form.append("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${botToken()}/sendDocument`, { method: "POST", body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    console.error("[external-telegram] sendDocument failed", json ?? res.status);
    return false;
  }
  return true;
}

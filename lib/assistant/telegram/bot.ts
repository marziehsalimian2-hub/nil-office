import "server-only";

/**
 * Thin fetch-based wrapper around the Telegram Bot HTTP API — no SDK
 * dependency needed, same minimal-footprint approach already used for
 * the Anthropic-only LLMProvider adapter. TELEGRAM_BOT_TOKEN is read
 * fresh from process.env on every call (never module-cached into a
 * constant that could end up in a stack trace) and never logged.
 */

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
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
    // Never interpolate the bot token into a log line — only the method/response.
    console.error(`[telegram] ${method} failed`, json ?? res.status);
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

/** Drops the inline keyboard after a decision is made — UX-level double-tap defense in addition to the DB-level one. */
export async function clearInlineKeyboard(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

/** Resolves a Telegram file_id (e.g. a voice note) to a downloadable URL. Caller fetches the bytes itself — nothing here touches disk. */
export async function getFileDownloadUrl(fileId: string): Promise<string | null> {
  const result = (await call("getFile", { file_id: fileId })) as { ok: boolean; result?: { file_path: string } } | null;
  const filePath = result?.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${botToken()}/${filePath}`;
}

/** Sends a document (e.g. a finalized letter/invoice PDF) to a chat — multipart upload, no SDK dependency. */
export async function sendDocument(chatId: number, buffer: Buffer, filename: string, caption?: string): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  if (caption) form.append("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${botToken()}/sendDocument`, { method: "POST", body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    console.error("[telegram] sendDocument failed", json ?? res.status);
    return false;
  }
  return true;
}

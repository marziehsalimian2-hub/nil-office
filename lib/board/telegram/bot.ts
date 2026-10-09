import "server-only";

/**
 * Thin fetch-based wrapper around the Telegram Bot API for the BOARD bot. Its own token (BOARD_TELEGRAM_BOT_TOKEN) — never the
 * assistant bot's or the external-correspondence bot's: three independent trust zones. Read fresh from process.env, never logged.
 */

export function boardBotConfigured(): boolean {
  return !!process.env.BOARD_TELEGRAM_BOT_TOKEN;
}

function botToken(): string {
  const token = process.env.BOARD_TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("BOARD_TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

async function call(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result?: unknown; description?: string } | null;
    if (!res.ok || !json?.ok) console.error(`[board-telegram] ${method} failed`, json?.description ?? res.status);
    return json;
  } catch (e) {
    console.error(`[board-telegram] ${method} network error`, e instanceof Error ? e.message : e);
    return null;
  }
}

export type InlineKeyboardButton = { text: string; callback_data: string };

/** Telegram caps a message at 4096 UTF-16 units; long texts are cut (never split into several sends). */
const clip = (s: string) => (s.length > 3900 ? `${s.slice(0, 3900)}…` : s);

export async function sendMessage(chatId: number, text: string, keyboard?: InlineKeyboardButton[][]): Promise<boolean> {
  const r = await call("sendMessage", {
    chat_id: chatId,
    text: clip(text),
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
  return !!r?.ok;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export async function clearInlineKeyboard(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

/** Downloads an uploaded file's bytes (Telegram bots can fetch files up to 20 MB). Null on any failure. */
export async function downloadTelegramFile(fileId: string): Promise<Buffer | null> {
  const r = await call("getFile", { file_id: fileId });
  const filePath = (r?.result as { file_path?: string } | undefined)?.file_path;
  if (!filePath) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${botToken()}/${filePath}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function sendDocument(chatId: number, buffer: Buffer, filename: string, caption?: string): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
    if (caption) form.append("caption", clip(caption).slice(0, 1000));
    const res = await fetch(`https://api.telegram.org/bot${botToken()}/sendDocument`, { method: "POST", body: form });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || !json?.ok) {
      console.error("[board-telegram] sendDocument failed", json?.description ?? res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[board-telegram] sendDocument network error", e instanceof Error ? e.message : e);
    return false;
  }
}

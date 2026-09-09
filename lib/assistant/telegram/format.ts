import "server-only";
import type { ChatTurnResult } from "@/lib/assistant/orchestrator";
import type { InlineKeyboardButton } from "./bot";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const SAFE_CHUNK_SIZE = 3800; // headroom below the hard limit
const MAX_CARDS_SHOWN = 6;

/**
 * ChatTurnResult (the same shape the web ChatPanel already renders) ->
 * Telegram text + inline keyboard. Kept short and bulleted (spec §18) —
 * this is a phone screen, not the Executive Dashboard. Long answers are
 * split on paragraph boundaries (spec §19) rather than cut mid-sentence.
 */
export function formatChatTurnForTelegram(result: ChatTurnResult): { chunks: string[]; keyboard?: InlineKeyboardButton[][] } {
  let text = result.text.trim();

  if (result.cards.length > 0) {
    const shown = result.cards.slice(0, MAX_CARDS_SHOWN);
    const lines = shown.map((c) => `• ${c.title}${c.subtitle ? ` — ${c.subtitle}` : ""}\n  ${absoluteUrl(c.href)}`);
    text += `\n\n${lines.join("\n")}`;
    if (result.cards.length > shown.length) {
      text += `\n\n(${result.cards.length - shown.length} مورد دیگر — برای مشاهدهٔ کامل به NIL Office مراجعه کنید)`;
    }
  }

  if (result.pendingAction) {
    text += `\n\n${result.pendingAction.previewText}`;
  }

  const chunks = splitIntoChunks(text);
  const keyboard: InlineKeyboardButton[][] | undefined = result.pendingAction
    ? [[{ text: "✅ تأیید", callback_data: `confirm:${result.pendingAction.id}` }, { text: "❌ لغو", callback_data: `cancel:${result.pendingAction.id}` }]]
    : undefined;

  return { chunks, keyboard };
}

function absoluteUrl(href: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (href.startsWith("http")) return href;
  return `${base}${href}`;
}

function splitIntoChunks(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SAFE_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n\n", SAFE_CHUNK_SIZE);
    if (cut <= 0) cut = remaining.lastIndexOf("\n", SAFE_CHUNK_SIZE);
    if (cut <= 0) cut = SAFE_CHUNK_SIZE;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

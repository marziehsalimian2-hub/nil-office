import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isAllowedTelegramUser, isPrivateChat } from "./security";
import { resolveProfileForTelegramUser } from "./identity";
import { getSessionClientForProfile } from "./session";
import { sendMessage, answerCallbackQuery, clearInlineKeyboard, getFileDownloadUrl, sendDocument } from "./bot";
import { formatChatTurnForTelegram } from "./format";
import { runChatTurn } from "@/lib/assistant/orchestrator";
import { confirmPendingAction, cancelPendingAction } from "@/lib/assistant/confirmation";
import { getSpeechToTextProvider } from "@/lib/assistant/speech";
import { buildLetterPdfForCorrespondence } from "@/lib/pdf/letterData";
import { buildInvoicePdf } from "@/lib/pdf/invoiceData";
import type { Profile } from "@/lib/types/database";

// Minimal shape of what this handler actually reads — not the full Telegram Update schema.
type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
    voice?: { file_id: string; duration: number };
  };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number; type: string } } };
};

const ACCESS_DENIED_TEXT = "دسترسی شما به این ربات مجاز نیست.";
const NOT_LINKED_TEXT = "حساب شما هنوز به NIL Office متصل نشده است. لطفاً با مدیر سامانه تماس بگیرید.";
const UNAVAILABLE_TEXT = "دستیار نیل موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.";

const MAX_VOICE_BYTES = 15 * 1024 * 1024;
const MAX_VOICE_DURATION_SECONDS = 300;

/** Actions whose successful confirmation results in an official document that should be delivered to Telegram (spec §13/§21). Every other action (tasks, followups, cheques, ...) is a no-op here. */
const DOCUMENT_ACTIONS: Record<string, "LETTER" | "INVOICE"> = {
  CREATE_LETTER_DRAFT: "LETTER",
  CREATE_INVOICE_DRAFT: "INVOICE",
};

const SLASH_ALIASES: Record<string, string> = {
  "/start": "سلام نیل",
  "/today": "امروز چه کارهایی دارم؟",
  "/attention": "چه چیزهایی نیاز به توجه دارند؟",
  "/projects": "وضعیت پروژه‌ها را نشان بده",
  "/contracts": "قراردادهای نزدیک پایان را نشان بده",
  "/invoices": "فاکتورهای پرداخت‌نشده را نشان بده",
  "/help": "چه کارهایی می‌توانی برای من انجام بدی؟",
};

/**
 * Resolves a Telegram sender to a NIL Office profile + a real, RLS-bound
 * session client — the SAME allowlist -> identity -> session pipeline
 * for both a text message and a button tap (spec §14 requires the
 * callback path to re-verify everything a fresh message would).
 * Authorization is read only from the caller's own numeric id — never
 * from forwarded-message metadata (spec §28) or a username (spec §1).
 */
async function authorize(telegramUserId: number): Promise<{ profile: Profile; sessionClient: Awaited<ReturnType<typeof getSessionClientForProfile>> } | { denied: "NOT_ALLOWED" | "NOT_LINKED" }> {
  if (!isAllowedTelegramUser(telegramUserId)) return { denied: "NOT_ALLOWED" };

  const service = createServiceClient();
  const mapped = await resolveProfileForTelegramUser(service, telegramUserId);
  if (!mapped) return { denied: "NOT_LINKED" };

  const sessionClient = await getSessionClientForProfile(mapped.profileId);
  const { data: profile } = await sessionClient.from("profiles").select("*").eq("id", mapped.profileId).single();
  if (!profile || !profile.is_active) return { denied: "NOT_LINKED" };

  return { profile: profile as Profile, sessionClient };
}

/**
 * Voice pipeline (spec §7): download the Telegram voice note entirely
 * in-memory (never written to disk — nothing to clean up, spec §66),
 * transcribe it, and hand the plain transcript back. The caller is
 * responsible for the transcript-preview echo (spec §9) before ever
 * feeding it into runChatTurn — from that point on, voice is just text.
 */
async function transcribeVoice(fileId: string, durationSeconds: number): Promise<{ text: string; confidence: string } | { error: string }> {
  if (durationSeconds > MAX_VOICE_DURATION_SECONDS) {
    return { error: "پیام صوتی خیلی طولانی است (حداکثر ۵ دقیقه)." };
  }

  const url = await getFileDownloadUrl(fileId);
  if (!url) return { error: "دریافت فایل صوتی از تلگرام ناموفق بود." };

  const res = await fetch(url);
  if (!res.ok) return { error: "دانلود فایل صوتی ناموفق بود." };
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_VOICE_BYTES) return { error: "حجم فایل صوتی بیش از حد مجاز است." };

  try {
    const stt = getSpeechToTextProvider();
    const result = await stt.transcribe(Buffer.from(arrayBuffer), { mimeType: "audio/ogg", language: "fa" });
    if (!result.text) return { error: "متنی از پیام صوتی تشخیص داده نشد." };
    return result;
  } catch (err) {
    console.error("[telegram] voice transcription failed", err);
    return { error: "تبدیل ویس به متن ناموفق بود. لطفاً بعداً دوباره تلاش کنید یا متن را تایپ کنید." };
  }
}

/**
 * Fetches the just-finalized document's PDF and sends it to the same
 * chat (spec §13/§21). Failure-safe (spec §14/§77): the official number
 * has already been assigned before this ever runs, so a delivery
 * failure here can NEVER be retried into a duplicate — the resend
 * button below only re-fetches and re-sends, it never re-creates or
 * re-numbers anything.
 */
async function deliverDocumentPdf(
  sessionClient: Awaited<ReturnType<typeof getSessionClientForProfile>>,
  chatId: number,
  actionName: string,
  resultId: string,
): Promise<void> {
  const kind = DOCUMENT_ACTIONS[actionName];
  if (!kind) return;

  try {
    const { buffer, fileName, displayNumber } = await buildDocumentPdf(sessionClient, kind, resultId);
    const sent = await sendDocument(chatId, buffer, fileName);
    if (sent) return;
    const label = kind === "LETTER" ? "نامه" : "فاکتور";
    await sendMessage(
      chatId,
      `${label} در NIL Office با شماره ${displayNumber ?? "-"} ثبت شد، اما ارسال فایل در تلگرام ناموفق بود.`,
      [[{ text: "ارسال مجدد فایل", callback_data: `resend:${kind}:${resultId}` }]],
    );
  } catch (err) {
    console.error("[telegram] deliverDocumentPdf failed", err);
    await sendMessage(chatId, "سند در NIL Office ثبت شد، اما تولید فایل برای ارسال با خطا مواجه شد. از داخل NIL Office قابل دانلود است.");
  }
}

async function buildDocumentPdf(
  sessionClient: Awaited<ReturnType<typeof getSessionClientForProfile>>,
  kind: "LETTER" | "INVOICE",
  id: string,
): Promise<{ buffer: Buffer; fileName: string; displayNumber: string | null }> {
  if (kind === "LETTER") {
    const { data } = await sessionClient.from("correspondence").select("display_number").eq("id", id).single();
    const { buffer, fileName } = await buildLetterPdfForCorrespondence(sessionClient, id);
    return { buffer, fileName, displayNumber: data?.display_number ?? null };
  }
  const { data } = await sessionClient.from("sales_documents").select("display_number").eq("id", id).single();
  const { buffer, fileName } = await buildInvoicePdf(sessionClient, id);
  return { buffer, fileName, displayNumber: data?.display_number ?? null };
}

async function findOrCreateTelegramConversation(sessionClient: Awaited<ReturnType<typeof getSessionClientForProfile>>, profileId: string): Promise<string> {
  const { data: existing } = await sessionClient
    .from("assistant_conversations")
    .select("id")
    .eq("user_id", profileId)
    .eq("channel", "TELEGRAM")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await sessionClient
    .from("assistant_conversations")
    .insert({ user_id: profileId, channel: "TELEGRAM", title: "تلگرام" })
    .select("id")
    .single();
  if (error || !created) throw new Error(`failed to create Telegram conversation: ${error?.message}`);
  return created.id;
}

async function handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  if (!isPrivateChat(msg.chat.type)) return; // spec §26/§27 — groups/channels ignored entirely, no reply
  const telegramUserId = msg.from?.id;
  if (!telegramUserId || (!msg.text && !msg.voice)) return;

  const auth = await authorize(telegramUserId);
  if ("denied" in auth) {
    await sendMessage(msg.chat.id, auth.denied === "NOT_ALLOWED" ? ACCESS_DENIED_TEXT : NOT_LINKED_TEXT);
    return;
  }

  let text: string;
  if (msg.voice) {
    const transcribed = await transcribeVoice(msg.voice.file_id, msg.voice.duration);
    if ("error" in transcribed) {
      await sendMessage(msg.chat.id, transcribed.error);
      return;
    }
    // Transcript preview (spec §9) — always shown before any action, so a
    // misheard number/name/recipient is caught before the model acts on it.
    const lowConfidenceNote = transcribed.confidence === "LOW" ? "\n\nلطفاً اگر اشتباه شنیده شد، دوباره بگو یا تصحیح کن." : "";
    await sendMessage(msg.chat.id, `🎙 شنیدم: ${transcribed.text}${lowConfidenceNote}`);
    text = transcribed.text;
  } else {
    text = SLASH_ALIASES[msg.text!.trim()] ?? msg.text!;
  }

  try {
    const conversationId = await findOrCreateTelegramConversation(auth.sessionClient, auth.profile.id);
    const result = await runChatTurn(auth.sessionClient, auth.profile, conversationId, text);
    const { chunks, keyboard } = formatChatTurnForTelegram(result);
    for (let i = 0; i < chunks.length; i++) {
      await sendMessage(msg.chat.id, chunks[i], i === chunks.length - 1 ? keyboard : undefined);
    }
  } catch (err) {
    console.error("[telegram] handleMessage failed", err);
    await sendMessage(msg.chat.id, UNAVAILABLE_TEXT);
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  if (!cb.message || !isPrivateChat(cb.message.chat.type) || !cb.data) {
    await answerCallbackQuery(cb.id);
    return;
  }

  const auth = await authorize(cb.from.id);
  if ("denied" in auth) {
    await answerCallbackQuery(cb.id, ACCESS_DENIED_TEXT);
    return;
  }

  // Resend a document's PDF after a prior delivery failure (spec §14/§77)
  // — pure read + re-send, never touches the Confirmation Engine, so it
  // can NEVER create a second record or a second official number.
  if (cb.data.startsWith("resend:")) {
    const [, kind, resendId] = cb.data.split(":");
    await answerCallbackQuery(cb.id);
    if ((kind === "LETTER" || kind === "INVOICE") && resendId) {
      await deliverDocumentPdf(auth.sessionClient, cb.message.chat.id, kind === "LETTER" ? "CREATE_LETTER_DRAFT" : "CREATE_INVOICE_DRAFT", resendId);
    }
    return;
  }

  const [decision, pendingActionId] = cb.data.split(":");
  if (!pendingActionId || (decision !== "confirm" && decision !== "cancel")) {
    await answerCallbackQuery(cb.id);
    return;
  }

  try {
    // confirmPendingAction/cancelPendingAction are UNCHANGED from the web
    // path — their own .eq("user_id", userId) already refuses a
    // different user's pending action (spec §14), and the atomic UPDATE
    // already makes a double-tap a no-op (spec §31/§40).
    let ok: boolean;
    let errorMessage: string | undefined;
    let confirmedActionName: string | undefined;
    let confirmedResultId: string | undefined;
    if (decision === "confirm") {
      const result = await confirmPendingAction(auth.sessionClient, auth.profile.id, pendingActionId);
      ok = result.ok;
      if (result.ok) {
        confirmedActionName = result.actionName;
        confirmedResultId = result.resultId;
      } else {
        errorMessage = result.error;
      }
    } else {
      const result = await cancelPendingAction(auth.sessionClient, auth.profile.id, pendingActionId);
      ok = result.ok;
    }

    await answerCallbackQuery(cb.id);
    await clearInlineKeyboard(cb.message.chat.id, cb.message.message_id);
    const text = ok ? (decision === "confirm" ? "انجام شد. ثبت شد." : "لغو شد.") : (errorMessage ?? "این درخواست دیگر معتبر نیست.");
    await sendMessage(cb.message.chat.id, text);

    if (ok && decision === "confirm" && confirmedActionName && confirmedResultId) {
      await deliverDocumentPdf(auth.sessionClient, cb.message.chat.id, confirmedActionName, confirmedResultId);
    }
  } catch (err) {
    console.error("[telegram] handleCallbackQuery failed", err);
    await answerCallbackQuery(cb.id);
    await sendMessage(cb.message.chat.id, UNAVAILABLE_TEXT);
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallbackQuery(update.callback_query);
}

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isAllowedTelegramUser, isPrivateChat } from "./security";
import { resolveProfileForTelegramUser } from "./identity";
import { getSessionClientForProfile } from "./session";
import { sendMessage, answerCallbackQuery, clearInlineKeyboard, getFileDownloadUrl, sendDocument } from "./bot";
import { formatChatTurnForTelegram, stripMarkdownEmphasis } from "./format";
import { detectTelegramAttachment, MAX_TELEGRAM_ATTACHMENT_BYTES } from "./attachment";
import { runChatTurn, saveMessage, type ChatAttachment } from "@/lib/assistant/orchestrator";
import { confirmPendingAction, cancelPendingAction, createPendingAction } from "@/lib/assistant/confirmation";
import { getAction } from "@/lib/assistant/actions/registry";
import { hasAccess, type DeliveryHint, type WriteProposal } from "@/lib/assistant/actions/types";
import { hasServiceLedgerAccess } from "@/lib/assistant/actions/access";
import { auditAssistant, recordUsage, getUsageToday, evaluateCaps } from "@/lib/assistant/usage";
import { getSpeechToTextProvider } from "@/lib/assistant/speech";
import { getLLMProvider } from "@/lib/assistant/llm";
import { buildSystemPrompt } from "@/lib/assistant/systemPrompt";
import { buildLetterPdfForCorrespondence } from "@/lib/pdf/letterData";
import { buildInvoicePdf } from "@/lib/pdf/invoiceData";
import { isUuid } from "@/lib/upload-validation";
import { consumePickToken, rememberResolved, typeLabelFa } from "@/lib/assistant/entityLedger";
import { cleanText } from "@/lib/assistant/cashDraft";
import { MENU_CALLBACK_PREFIX, MENU_TITLE, buildMenuKeyboard, isMenuRequest, resolveMenuCallback } from "./menu";
import type { Profile } from "@/lib/types/database";

// Minimal shape of what this handler actually reads — not the full Telegram Update schema.
type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration: number };
    photo?: { file_id: string; file_size?: number }[];
    document?: { file_id: string; mime_type?: string; file_size?: number };
  };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number; type: string } } };
};

type SessionClient = Awaited<ReturnType<typeof getSessionClientForProfile>>;
type DocKind = "LETTER" | "INVOICE" | "SERVICE_REPORT";

const ACCESS_DENIED_TEXT = "دسترسی شما به این ربات مجاز نیست.";
const NOT_LINKED_TEXT = "حساب شما هنوز به NIL Office متصل نشده است. لطفاً با مدیر سامانه تماس بگیرید.";
const UNAVAILABLE_TEXT = "دستیار نیل موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.";

const MAX_VOICE_BYTES = 15 * 1024 * 1024;
const MAX_VOICE_DURATION_SECONDS = 300;
const DEFAULT_ATTACHMENT_PROMPT = "این تصویر/سند را بررسی کن — اگر نامهٔ واردهاست، اطلاعات آن را استخراج کن.";
const ALLOWED_DOCUMENT_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Actions whose successful confirmation results in an OFFICIAL document that should be delivered to Telegram
 * (spec §13/§21). Since the draft/finalize split, a draft confirmation delivers nothing — the PDF only exists
 * once the SEPARATE issue step (FINALIZE_LETTER / ISSUE_SALES_DOCUMENT) has run.
 */
const DOCUMENT_ACTIONS: Record<string, DocKind> = {
  FINALIZE_LETTER: "LETTER",
  ISSUE_SALES_DOCUMENT: "INVOICE",
  PREPARE_CLIENT_SERVICE_REPORT: "SERVICE_REPORT",
};

/** Every action that assigns an official display_number — so the confirmation reply states the number (not just "ثبت شد") and the model's own history knows what really happened. */
const NUMBERED_RECORD_ACTIONS: Record<string, { table: "correspondence" | "sales_documents"; label: string }> = {
  FINALIZE_LETTER: { table: "correspondence", label: "نامه" },
  REGISTER_INCOMING_LETTER: { table: "correspondence", label: "نامهٔ وارده" },
  ISSUE_SALES_DOCUMENT: { table: "sales_documents", label: "فاکتور/پیش‌فاکتور" },
};

/** Draft-only actions: confirming saves a numberless draft; the separate «صدور رسمی» step is offered right after (spec §8/§9/§73). */
const DRAFT_ACTIONS: Record<string, { label: string; kind: "LETTER" | "INVOICE" }> = {
  CREATE_LETTER_DRAFT: { label: "نامه", kind: "LETTER" },
  CREATE_INVOICE_DRAFT: { label: "فاکتور/پیش‌فاکتور", kind: "INVOICE" },
};

/** Receipt / payment drafts (Slice 2): the confirmation saves a DRAFT only — the reply says exactly that and never implies verified / posted / settled. */
const CASH_DRAFT_ACTIONS: Record<string, { noun: string; table: "receipts" | "payments" }> = {
  CREATE_RECEIPT_DRAFT: { noun: "دریافت", table: "receipts" },
  CREATE_PAYMENT_DRAFT: { noun: "پرداخت/هزینه", table: "payments" },
};

const FINALIZE_ACTION_BY_KIND = { LETTER: "FINALIZE_LETTER", INVOICE: "ISSUE_SALES_DOCUMENT" } as const;

/**
 * The plain "انجام شد. ثبت شد." success text never stated the actual official number, and — more importantly —
 * the whole confirm/cancel exchange happens over a callback_query, a code path that never writes into
 * assistant_messages at all. Without persisting SOMETHING here, the model's own conversation history still
 * shows only the original unconfirmed proposal on the next turn. For a draft the text carries the record id so
 * the model can later propose the official issue step for exactly that record (never guessing an id).
 */
async function buildConfirmationOutcomeText(sessionClient: SessionClient, actionName: string, resultId: string): Promise<string> {
  const draft = DRAFT_ACTIONS[actionName];
  if (draft) return `پیش‌نویس ${draft.label} ذخیره شد و هنوز شمارهٔ رسمی ندارد. (شناسهٔ پیش‌نویس: ${resultId})`;

  const cash = CASH_DRAFT_ACTIONS[actionName];
  if (cash) {
    return `پیش‌نویس ${cash.noun} ذخیره شد؛ هنوز تأیید، ثبت قطعی یا تسویه نشده است. تکمیل حساب‌ها، تأیید و ثبت فقط توسط حسابدار در NIL Office (بخش حسابداری ← ${cash.table === "receipts" ? "دریافت‌ها" : "پرداخت‌ها"}) انجام می‌شود. (شناسهٔ پیش‌نویس: ${resultId})`;
  }

  const meta = NUMBERED_RECORD_ACTIONS[actionName];
  if (!meta) return "انجام شد. ثبت شد.";
  const { data } = await sessionClient.from(meta.table).select("display_number").eq("id", resultId).single();
  return data?.display_number ? `${meta.label} با شمارهٔ رسمی ${data.display_number} صادر/ثبت شد.` : "انجام شد. ثبت شد.";
}

/**
 * REGISTER_INCOMING_LETTER's own confirm/cancel exchange happens over a callback_query (see handleCallbackQuery),
 * a code path that never calls runChatTurn — so systemPrompt rule 11's reply/follow-up suggestion has nowhere to
 * run once the user has only tapped a button. This makes one small, tool-free LLM call right after a successful
 * registration so that suggestion still reaches the user, as its own message.
 */
async function suggestIncomingLetterFollowup(sessionClient: SessionClient, profile: Profile, chatId: number, conversationId: string, correspondenceId: string): Promise<void> {
  // recipient_name doubles as "sender" for an INCOMING letter — the same column outgoing letters use for their
  // recipient. There is no separate sender_name column.
  const { data } = await sessionClient.from("correspondence").select("display_number, subject, draft_text, recipient_name").eq("id", correspondenceId).single();
  if (!data) return;

  const prompt = `یک نامهٔ وارده هم‌اکنون با شمارهٔ ${data.display_number} ثبت شد:
موضوع: ${data.subject ?? "-"}
فرستنده: ${data.recipient_name ?? "-"}
متن/خلاصه: ${data.draft_text ?? "-"}

طبق قانون ۱۱، دربارهٔ این نامه به کاربر پیشنهاد بده (پیگیری یا پیش‌نویس پاسخ) اگر لازم است — در غیر این صورت فقط کوتاه بگو این نامه صرفاً اطلاع‌رسانی است و نیازی به اقدام ندارد. هیچ ابزاری را در همین پیام فراخوانی نکن، فقط متن پاسخ بده.`;

  try {
    const startedAt = Date.now();
    const result = await getLLMProvider().converseWithTools({
      systemPrompt: buildSystemPrompt(profile.full_name),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    if (result.usage) await recordUsage(sessionClient, profile.id, "TELEGRAM", "LLM", result.usage.inputTokens, result.usage.outputTokens, Date.now() - startedAt);
    const text = stripMarkdownEmphasis(result.text.trim());
    if (!text) return;
    await sendMessage(chatId, text);
    await saveMessage(sessionClient, conversationId, "assistant", text);
  } catch (err) {
    console.error("[telegram] incoming-letter followup suggestion failed", err);
  }
}

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
 * Resolves a Telegram sender to a NIL Office profile + a real, RLS-bound session client — the SAME allowlist ->
 * identity -> session pipeline for both a text message and a button tap (spec §14 requires the callback path to
 * re-verify everything a fresh message would). Authorization is read only from the caller's own numeric id —
 * never from forwarded-message metadata (spec §28) or a username (spec §1).
 */
async function authorize(telegramUserId: number): Promise<{ profile: Profile; sessionClient: SessionClient } | { denied: "NOT_ALLOWED" | "NOT_LINKED" }> {
  if (!isAllowedTelegramUser(telegramUserId)) return { denied: "NOT_ALLOWED" };

  const service = createServiceClient();
  const mapped = await resolveProfileForTelegramUser(service, telegramUserId);
  if (!mapped) return { denied: "NOT_LINKED" };

  const sessionClient = await getSessionClientForProfile(mapped.profileId);
  const { data: profile } = await sessionClient.from("profiles").select("*").eq("id", mapped.profileId).single();
  if (!profile || !profile.is_active) return { denied: "NOT_LINKED" };

  return { profile: profile as Profile, sessionClient };
}

/** Audited (rate-limited in SQL) refusal for a sender the bot does not serve — the reply text stays the same generic one. */
async function refuseUnauthorized(denied: "NOT_ALLOWED" | "NOT_LINKED"): Promise<void> {
  await auditAssistant(createServiceClient(), null, "UNAUTHORIZED_TELEGRAM", null, { reason: denied });
}

/**
 * Voice pipeline (spec §7): download the Telegram voice note entirely in-memory (never written to disk —
 * nothing to clean up, spec §66), transcribe it, and hand the plain transcript back. The caller echoes the
 * transcript (spec §9) before ever feeding it into runChatTurn — from that point on, voice is just text. The
 * per-minute voice cap is checked BEFORE the download/transcription so a flood costs nothing.
 */
async function transcribeVoice(sessionClient: SessionClient, profileId: string, fileId: string, durationSeconds: number): Promise<{ text: string; confidence: string } | { error: string }> {
  if (durationSeconds > MAX_VOICE_DURATION_SECONDS) {
    return { error: "پیام صوتی خیلی طولانی است (حداکثر ۵ دقیقه)." };
  }

  const cap = evaluateCaps(await getUsageToday(sessionClient, profileId), "STT");
  if (!cap.ok) {
    await auditAssistant(sessionClient, profileId, "CAP_EXCEEDED", null, { kind: "STT", reason: cap.reason });
    return { error: cap.message };
  }

  const url = await getFileDownloadUrl(fileId);
  if (!url) return { error: "دریافت فایل صوتی از تلگرام ناموفق بود." };

  const res = await fetch(url);
  if (!res.ok) return { error: "دانلود فایل صوتی ناموفق بود." };
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_VOICE_BYTES) return { error: "حجم فایل صوتی بیش از حد مجاز است." };

  const startedAt = Date.now();
  try {
    const stt = getSpeechToTextProvider();
    const result = await stt.transcribe(Buffer.from(arrayBuffer), { mimeType: "audio/ogg", language: "fa" });
    await recordUsage(sessionClient, profileId, "TELEGRAM", "STT", durationSeconds, 0, Date.now() - startedAt);
    await auditAssistant(sessionClient, profileId, "VOICE_TRANSCRIBED", null, { seconds: durationSeconds, confidence: result.confidence ?? null });
    if (!result.text) return { error: "متنی از پیام صوتی تشخیص داده نشد." };
    return result;
  } catch (err) {
    console.error("[telegram] voice transcription failed", err);
    return { error: "تبدیل ویس به متن ناموفق بود. لطفاً بعداً دوباره تلاش کنید یا متن را تایپ کنید." };
  }
}

/**
 * Photo/document pipeline (spec §25/§35/§63): download entirely in-memory (never written to disk), then decide
 * the file's REAL type from its own leading bytes (attachment.ts) — the declared MIME type and file name are
 * attacker-controlled. Only PDF/JPEG/PNG/GIF/WebP reach the LLM or storage. The original bytes are handed
 * straight through to REGISTER_INCOMING_LETTER's payload for archival — the model never re-derives or
 * re-encodes the file itself.
 */
async function downloadAndValidateAttachment(
  sessionClient: SessionClient,
  profileId: string,
  fileId: string,
  declaredSize?: number,
): Promise<{ attachment: ChatAttachment } | { error: string }> {
  if (declaredSize && declaredSize > MAX_TELEGRAM_ATTACHMENT_BYTES) {
    await auditAssistant(sessionClient, profileId, "FILE_REJECTED", null, { reason: "SIZE" });
    return { error: "حجم فایل بیش از حد مجاز است (حداکثر ۱۵ مگابایت)." };
  }
  const url = await getFileDownloadUrl(fileId);
  if (!url) return { error: "دریافت فایل از تلگرام ناموفق بود." };
  const res = await fetch(url);
  if (!res.ok) return { error: "دانلود فایل ناموفق بود." };
  const bytes = new Uint8Array(await res.arrayBuffer());

  const detected = detectTelegramAttachment(bytes);
  if (!detected.ok) {
    await auditAssistant(sessionClient, profileId, "FILE_REJECTED", null, { reason: bytes.length > MAX_TELEGRAM_ATTACHMENT_BYTES ? "SIZE" : "SIGNATURE" });
    return { error: detected.error };
  }
  await auditAssistant(sessionClient, profileId, "FILE_PROCESSED", null, { kind: detected.kind, bytes: bytes.length });
  return { attachment: { kind: detected.kind, mediaType: detected.mediaType, data: Buffer.from(bytes).toString("base64") } };
}

/**
 * Fetches the just-issued document's PDF and sends it to the same chat (spec §13/§21). Failure-safe
 * (spec §14/§77): the official number has already been assigned before this ever runs, so a delivery failure
 * here can NEVER be retried into a duplicate — the resend button below only re-fetches and re-sends, it never
 * re-creates or re-numbers anything.
 */
async function deliverDocumentPdf(sessionClient: SessionClient, chatId: number, kind: DocKind, resultId: string): Promise<void> {
  try {
    const { buffer, fileName, displayNumber } = await buildDocumentPdf(sessionClient, kind, resultId);
    const sent = await sendDocument(chatId, buffer, fileName);
    if (sent) return;
    const label = kind === "LETTER" ? "نامه" : kind === "INVOICE" ? "فاکتور" : "گزارش";
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

async function buildDocumentPdf(sessionClient: SessionClient, kind: DocKind, id: string): Promise<{ buffer: Buffer; fileName: string; displayNumber: string | null }> {
  if (kind === "LETTER") {
    const { data } = await sessionClient.from("correspondence").select("display_number").eq("id", id).single();
    const { buffer, fileName } = await buildLetterPdfForCorrespondence(sessionClient, id);
    return { buffer, fileName, displayNumber: data?.display_number ?? null };
  }
  if (kind === "INVOICE") {
    const { data } = await sessionClient.from("sales_documents").select("display_number").eq("id", id).single();
    const { buffer, fileName } = await buildInvoicePdf(sessionClient, id);
    return { buffer, fileName, displayNumber: data?.display_number ?? null };
  }
  // SERVICE_REPORT — unlike LETTER/INVOICE, the PDF is already generated and archived (Phase 4's
  // client_service_reports.storage_path); this just downloads the existing bytes, no rendering call at delivery
  // time, and reports carry no display_number.
  const { data: report, error } = await sessionClient.from("client_service_reports").select("storage_path, file_name").eq("id", id).single();
  if (error || !report) throw new Error("گزارش یافت نشد.");
  const { data: file, error: downloadErr } = await sessionClient.storage.from("nil-files").download(report.storage_path);
  if (downloadErr || !file) throw new Error("بازیابی فایل گزارش ناموفق بود.");
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, fileName: report.file_name, displayNumber: null };
}

/**
 * The resend button is a plain callback string, so it must be treated as attacker-controlled: the caller may
 * only re-receive a document they created (an ADMIN: any), and only an already-ISSUED letter/invoice — never a
 * draft or someone else's record (the callback used to carry no user binding at all).
 */
async function canResend(sessionClient: SessionClient, profile: Profile, kind: DocKind, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  if (kind === "SERVICE_REPORT") {
    if (!hasServiceLedgerAccess(profile)) return false;
    const { data } = await sessionClient.from("client_service_reports").select("generated_by").eq("id", id).maybeSingle();
    return !!data && (data.generated_by === profile.id || profile.role === "ADMIN");
  }
  const table = kind === "LETTER" ? "correspondence" : "sales_documents";
  const { data } = await sessionClient.from(table).select("created_by, sequence_number").eq("id", id).maybeSingle();
  return !!data && data.sequence_number != null && (data.created_by === profile.id || profile.role === "ADMIN");
}

/**
 * Delivers the user's OWN archived payslip PDF (GET_MY_PAYSLIP's `deliver` hint). Ownership is re-verified here
 * by the SECURITY DEFINER function itself (0134) — the hint only names an id; "not yours" and "does not exist"
 * are the same refusal. The archived file is sent as-is (never regenerated) and the delivery is audited
 * (no amounts) in both audit trails.
 */
async function deliverPayslip(sessionClient: SessionClient, profile: Profile, chatId: number, hint: Extract<DeliveryHint, { kind: "PAYSLIP" }>): Promise<void> {
  try {
    const { data: info, error } = await sessionClient.rpc("assistant_payslip_file", { p_profile_id: profile.id, p_payslip_id: hint.payslipId });
    if (error || !info) {
      await sendMessage(chatId, "فیش حقوقی پیدا نشد.");
      return;
    }
    const { data: file, error: downloadErr } = await sessionClient.storage.from("nil-files").download((info as { storage_path: string }).storage_path);
    if (downloadErr || !file) {
      await sendMessage(chatId, "بازیابی فایل فیش ناموفق بود. از بخش «فیش‌های من» در NIL Office هم قابل دریافت است.");
      return;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sent = await sendDocument(chatId, buffer, (info as { file_name: string }).file_name || `payslip-${hint.label}.pdf`);
    if (!sent) {
      await sendMessage(chatId, "ارسال فایل فیش در تلگرام ناموفق بود. از بخش «فیش‌های من» در NIL Office قابل دریافت است.");
      return;
    }
    await sessionClient.rpc("assistant_record_payslip_access", { p_profile_id: profile.id, p_payslip_id: hint.payslipId });
    await auditAssistant(sessionClient, profile.id, "PAYSLIP_DELIVERED", "GET_MY_PAYSLIP", { payslip_id: hint.payslipId });
  } catch (err) {
    console.error("[telegram] deliverPayslip failed", err);
    await sendMessage(chatId, "ارسال فیش با خطا مواجه شد. از بخش «فیش‌های من» در NIL Office قابل دریافت است.");
  }
}

async function findOrCreateTelegramConversation(sessionClient: SessionClient, profileId: string): Promise<string> {
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

/** Runs one assistant turn for an authorised user and sends the reply (text chunks, confirm / choice keyboard, delivered files). */
async function runTurnAndReply(
  auth: { profile: Profile; sessionClient: SessionClient },
  chatId: number,
  text: string,
  attachment?: ChatAttachment,
): Promise<void> {
  try {
    const conversationId = await findOrCreateTelegramConversation(auth.sessionClient, auth.profile.id);
    const result = await runChatTurn(auth.sessionClient, auth.profile, conversationId, text, attachment, "TELEGRAM");
    const { chunks, keyboard } = formatChatTurnForTelegram(result);
    for (let i = 0; i < chunks.length; i++) {
      await sendMessage(chatId, chunks[i], i === chunks.length - 1 ? keyboard : undefined);
    }
    for (const hint of result.deliveries ?? []) {
      if (hint.kind === "PAYSLIP") await deliverPayslip(auth.sessionClient, auth.profile, chatId, hint);
    }
  } catch (err) {
    console.error("[telegram] turn failed", err);
    await sendMessage(chatId, UNAVAILABLE_TEXT);
  }
}

async function handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  if (!isPrivateChat(msg.chat.type)) return; // spec §26/§27 — groups/channels ignored entirely, no reply
  const telegramUserId = msg.from?.id;
  const hasContent = Boolean(msg.text || msg.voice || (msg.photo && msg.photo.length > 0) || msg.document);
  if (!telegramUserId || !hasContent) return;

  const auth = await authorize(telegramUserId);
  if ("denied" in auth) {
    await refuseUnauthorized(auth.denied);
    await sendMessage(msg.chat.id, auth.denied === "NOT_ALLOWED" ? ACCESS_DENIED_TEXT : NOT_LINKED_TEXT);
    return;
  }

  // Optional quick-action menu (spec §58) — a fixed keyboard filtered by the user's role; no LLM, nothing written.
  if (isMenuRequest(msg.text)) {
    await sendMessage(msg.chat.id, MENU_TITLE, buildMenuKeyboard(auth.profile));
    return;
  }

  let text: string;
  let attachment: ChatAttachment | undefined;

  if (msg.voice) {
    const transcribed = await transcribeVoice(auth.sessionClient, auth.profile.id, msg.voice.file_id, msg.voice.duration);
    if ("error" in transcribed) {
      await sendMessage(msg.chat.id, transcribed.error);
      return;
    }
    // Transcript preview (spec §9) — always shown before any action, so a misheard number/name/recipient is
    // caught before the model acts on it.
    const lowConfidenceNote = transcribed.confidence === "LOW" ? "\n\nلطفاً اگر اشتباه شنیده شد، دوباره بگو یا تصحیح کن." : "";
    await sendMessage(msg.chat.id, `🎙 شنیدم: ${transcribed.text}${lowConfidenceNote}`);
    text = transcribed.text;
  } else if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1]; // Telegram orders PhotoSize smallest -> largest
    const downloaded = await downloadAndValidateAttachment(auth.sessionClient, auth.profile.id, largest.file_id, largest.file_size);
    if ("error" in downloaded) {
      await sendMessage(msg.chat.id, downloaded.error);
      return;
    }
    attachment = downloaded.attachment;
    text = msg.caption?.trim() || DEFAULT_ATTACHMENT_PROMPT;
  } else if (msg.document) {
    const mime = msg.document.mime_type;
    if (mime && !ALLOWED_DOCUMENT_MIMES.has(mime)) {
      await auditAssistant(auth.sessionClient, auth.profile.id, "FILE_REJECTED", null, { reason: "TYPE" });
      await sendMessage(msg.chat.id, "فقط فایل تصویر یا PDF پذیرفته می‌شود.");
      return;
    }
    const downloaded = await downloadAndValidateAttachment(auth.sessionClient, auth.profile.id, msg.document.file_id, msg.document.file_size);
    if ("error" in downloaded) {
      await sendMessage(msg.chat.id, downloaded.error);
      return;
    }
    attachment = downloaded.attachment;
    text = msg.caption?.trim() || DEFAULT_ATTACHMENT_PROMPT;
  } else {
    text = SLASH_ALIASES[msg.text!.trim()] ?? msg.text!;
  }

  await runTurnAndReply(auth, msg.chat.id, text, attachment);
}

/**
 * «صدور رسمی» button handler — DETERMINISTIC: it builds the FINALIZE_LETTER / ISSUE_SALES_DOCUMENT proposal
 * straight from the callback's record id (the action's own handler re-reads the record from the database and
 * re-checks ownership + permission) and never re-invokes the LLM. The proposal is a normal pending action: it
 * still needs the explicit «تأیید» button, and confirmPendingAction revalidates permission again at execute time.
 */
async function handleFinalizeRequest(auth: { profile: Profile; sessionClient: SessionClient }, chatId: number, kind: string | undefined, recordId: string | undefined): Promise<void> {
  const actionName = kind === "LETTER" ? FINALIZE_ACTION_BY_KIND.LETTER : kind === "INVOICE" ? FINALIZE_ACTION_BY_KIND.INVOICE : null;
  const action = actionName ? getAction(actionName) : undefined;
  if (!action || !recordId || !isUuid(recordId)) {
    await sendMessage(chatId, "این درخواست معتبر نیست.");
    return;
  }
  if (!hasAccess(auth.profile, action.requiredAccess)) {
    await auditAssistant(auth.sessionClient, auth.profile.id, "PERMISSION_DENIED", action.name, { stage: "PROPOSE", channel: "TELEGRAM" });
    await sendMessage(chatId, "برای صدور رسمی این سند دسترسی لازم را ندارید.");
    return;
  }
  const parsed = action.inputSchema.safeParse(kind === "LETTER" ? { correspondence_id: recordId } : { sales_document_id: recordId });
  if (!parsed.success) {
    await sendMessage(chatId, "این درخواست معتبر نیست.");
    return;
  }
  try {
    const proposal = (await action.handler(parsed.data, { supabase: auth.sessionClient, userId: auth.profile.id, profile: auth.profile })) as WriteProposal;
    const created = await createPendingAction(auth.sessionClient, auth.profile.id, action.name, proposal.payload, proposal.previewText);
    const { chunks, keyboard } = formatChatTurnForTelegram({
      text: "لطفاً پیش‌نمایش را با دقت بررسی کنید؛ پس از تأیید شمارهٔ رسمی صادر می‌شود و برگشت‌پذیر نیست.",
      cards: [],
      pendingAction: { id: created.pendingActionId, previewText: created.previewText },
    });
    for (let i = 0; i < chunks.length; i++) {
      await sendMessage(chatId, chunks[i], i === chunks.length - 1 ? keyboard : undefined);
    }
  } catch (err) {
    await sendMessage(chatId, err instanceof Error ? err.message : UNAVAILABLE_TEXT);
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  if (!cb.message || !isPrivateChat(cb.message.chat.type) || !cb.data) {
    await answerCallbackQuery(cb.id);
    return;
  }

  const auth = await authorize(cb.from.id);
  if ("denied" in auth) {
    await refuseUnauthorized(auth.denied);
    await answerCallbackQuery(cb.id, ACCESS_DENIED_TEXT);
    return;
  }

  // Resend a document's PDF after a prior delivery failure (spec §14/§77) — pure read + re-send, never touches
  // the Confirmation Engine, so it can NEVER create a second record or a second official number. Bound to the
  // caller: only their own already-issued document (ADMIN: any).
  if (cb.data.startsWith("resend:")) {
    const [, kind, resendId] = cb.data.split(":");
    await answerCallbackQuery(cb.id);
    if ((kind === "LETTER" || kind === "INVOICE" || kind === "SERVICE_REPORT") && resendId) {
      if (!(await canResend(auth.sessionClient, auth.profile, kind, resendId))) {
        await auditAssistant(auth.sessionClient, auth.profile.id, "PERMISSION_DENIED", "RESEND", { kind });
        await sendMessage(cb.message.chat.id, "این فایل برای شما قابل ارسال نیست.");
        return;
      }
      await deliverDocumentPdf(auth.sessionClient, cb.message.chat.id, kind, resendId);
    }
    return;
  }

  // Quick-action menu tap: opaque key, role re-checked now (the profile above was loaded fresh for THIS tap).
  if (cb.data.startsWith(MENU_CALLBACK_PREFIX)) {
    await answerCallbackQuery(cb.id);
    const item = resolveMenuCallback(cb.data, auth.profile);
    if (!item) {
      await sendMessage(cb.message.chat.id, "این گزینه برای شما در دسترس نیست.");
      return;
    }
    if (item.kind === "GUIDE") {
      await sendMessage(cb.message.chat.id, item.guide ?? "");
      return;
    }
    await runTurnAndReply(auth, cb.message.chat.id, item.prompt ?? "");
    return;
  }

  // Candidate button for an AMBIGUOUS entity: the tap is the user's own choice (strongest resolution), then the
  // original request continues. The token is single-use, user-bound and expiring; callback_data held no id or name.
  if (cb.data.startsWith("pick:")) {
    await answerCallbackQuery(cb.id);
    const picked = consumePickToken(cb.data.slice("pick:".length), auth.profile.id);
    if (!picked) {
      await sendMessage(cb.message.chat.id, "این گزینه منقضی شده یا قبلاً استفاده شده؛ لطفاً دوباره درخواستت را بنویس.");
      return;
    }
    rememberResolved(auth.profile.id, picked.type, picked.id, picked.name, 1, 1, "USER_PICKED");
    await clearInlineKeyboard(cb.message.chat.id, cb.message.message_id);
    const safeName = cleanText(picked.name, 100) ?? "";
    await runTurnAndReply(auth, cb.message.chat.id, `من ${typeLabelFa(picked.type)} «${safeName}» را انتخاب کردم (شناسه: ${picked.id}). با همین ادامه بده.`);
    return;
  }

  // «صدور رسمی» — second, stronger step after a draft was saved (see handleFinalizeRequest).
  if (cb.data.startsWith("finalize:")) {
    const [, kind, recordId] = cb.data.split(":");
    await answerCallbackQuery(cb.id);
    await handleFinalizeRequest(auth, cb.message.chat.id, kind, recordId);
    return;
  }

  const [decision, pendingActionId] = cb.data.split(":");
  if (!pendingActionId || (decision !== "confirm" && decision !== "cancel")) {
    await answerCallbackQuery(cb.id);
    return;
  }

  try {
    // confirmPendingAction/cancelPendingAction refuse a different user's pending action (own-user filter), a
    // tampered payload and a user whose permission has lapsed (spec §14/§39/§41), and the atomic claim makes a
    // double-tap a no-op (spec §31/§40).
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

    const text = ok
      ? decision === "confirm" && confirmedActionName && confirmedResultId
        ? await buildConfirmationOutcomeText(auth.sessionClient, confirmedActionName, confirmedResultId)
        : "لغو شد."
      : (errorMessage ?? "این درخواست دیگر معتبر نیست.");

    // A saved draft offers the separate official-issue step right on the outcome message.
    const draft = ok && decision === "confirm" && confirmedActionName ? DRAFT_ACTIONS[confirmedActionName] : undefined;
    const issueKeyboard = draft && confirmedResultId ? [[{ text: "📌 صدور رسمی (شماره‌گذاری)", callback_data: `finalize:${draft.kind}:${confirmedResultId}` }]] : undefined;
    await sendMessage(cb.message.chat.id, text, issueKeyboard);

    // The confirm/cancel exchange itself never goes through runChatTurn, so without this the model's own history
    // has no record that the pending action was actually resolved — the next turn would still see only the
    // original unconfirmed proposal.
    const conversationId = await findOrCreateTelegramConversation(auth.sessionClient, auth.profile.id);
    await saveMessage(auth.sessionClient, conversationId, "assistant", text);

    if (ok && decision === "confirm" && confirmedActionName && confirmedResultId) {
      const docKind = DOCUMENT_ACTIONS[confirmedActionName];
      if (docKind) await deliverDocumentPdf(auth.sessionClient, cb.message.chat.id, docKind, confirmedResultId);
      if (confirmedActionName === "REGISTER_INCOMING_LETTER") {
        await suggestIncomingLetterFollowup(auth.sessionClient, auth.profile, cb.message.chat.id, conversationId, confirmedResultId);
      }
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

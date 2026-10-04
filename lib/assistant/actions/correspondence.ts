import "server-only";
import { z } from "zod";
import { formatJalali } from "@/lib/jalali";
import type { LetterDraftInput, IncomingLetterInput } from "@/app/actions/correspondence";
import { htmlToPlainText } from "./access";
import type { ActionDefinition } from "./types";

export const getCorrespondence: ActionDefinition<{ correspondence_id: string }> = {
  name: "GET_CORRESPONDENCE",
  description: "جزئیات یک نامهٔ صادره/وارده مشخص با شناسه. ابتدا با SEARCH_CORRESPONDENCE شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ correspondence_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase
      .from("correspondence")
      .select("id, display_number, subject, direction, status, recipient_name, created_at, finalized_at")
      .eq("id", input.correspondence_id)
      .single();
    if (!data) return { data: { note: "نامه‌ای با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return { data, cards: [{ kind: "correspondence", id: data.id, title: data.subject ?? "(بدون موضوع)", href: `/correspondence/${data.id}` }] };
  },
};

const createLetterDraftInput = z.object({
  subject: z.string().trim().min(1, "موضوع نامه الزامی است."),
  draft_text: z.string().trim().min(1, "متن نامه الزامی است."),
  recipient_company_id: z.string().uuid().optional(),
  recipient_name: z.string().trim().optional(),
  case_id: z.string().uuid().optional(),
  language: z.enum(["FA", "EN"]).optional(),
  // Set only when this letter is a reply to a specific incoming letter
  // (usually right after REGISTER_INCOMING_LETTER, once the user confirms
  // a reply is wanted) — links via the existing correspondence_links
  // REPLY_TO relation, same as the web UI's own createReplyDraft.
  reply_to_correspondence_id: z.string().uuid().optional(),
});

/**
 * MEDIUM-risk since the Internal Assistant v1.0 hardening (spec §8/§73): the confirmation here creates ONLY a
 * numberless DRAFT (createLetterDraftCore, app/actions/correspondence.ts). The official number is a SEPARATE,
 * stronger confirmation — FINALIZE_LETTER below — so a misheard recipient or subject in a voice message can be
 * fixed before anything irreversible happens. draft_text is composed by the model itself as this tool's own
 * parameter (spec §10) — no second LLM round-trip.
 */
export const createLetterDraft: ActionDefinition<z.infer<typeof createLetterDraftInput>> = {
  name: "CREATE_LETTER_DRAFT",
  description:
    "پیشنهاد نوشتن «پیش‌نویس» یک نامهٔ صادره (نه ثبت قطعی و نه صدور رسمی — فقط پیش‌نمایش برای تأیید کاربر؛ پس از تأیید فقط یک پیش‌نویس بدون شمارهٔ رسمی ذخیره می‌شود). متن نامه (draft_text) را خودت با لحن رسمی و حرفه‌ای اداری فارسی بنویس — کامل و آماده برای ارسال، نه خلاصه، و فقط تا پایان متن اصلی نامه؛ هرگز عبارت پایانی «با احترام»، نام امضاکننده یا سمت او را در انتهای draft_text ننویس — این بخش (نام و سمت تأییدکنندهٔ نامه) به‌طور خودکار توسط سیستم زیر مهر و امضا چاپ می‌شود. گیرنده را ترجیحاً با SEARCH_COMPANY پیدا کن و recipient_company_id را بفرست؛ اگر شرکتی در سیستم نبود، فقط recipient_name را بفرست. هرگز گیرنده یا موضوع را حدس نزن — اگر نامشخص است بپرس. اگر این نامه پاسخ به یک نامهٔ واردهٔ مشخص است، شناسهٔ آن نامه را در reply_to_correspondence_id بفرست. صدور رسمی (گرفتن شمارهٔ رسمی) مرحلهٔ جداگانه‌ای است: بعد از ساخته‌شدن پیش‌نویس، فقط اگر کاربر صریحاً خواست، با FINALIZE_LETTER پیشنهاد بده — هرگز نگو نامه شماره گرفته مگر وقتی FINALIZE_LETTER واقعاً تأیید و اجرا شده باشد.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: createLetterDraftInput,
  handler: async (input) => {
    if (!input.recipient_company_id && !input.recipient_name) {
      throw new Error("گیرندهٔ نامه (شرکت یا نام) باید مشخص باشد.");
    }

    const payload: LetterDraftInput = {
      subject: input.subject,
      draft_text: input.draft_text,
      recipient_company_id: input.recipient_company_id ?? null,
      recipient_name: input.recipient_name ?? null,
      case_id: input.case_id ?? null,
      language: input.language ?? "FA",
      reply_to_correspondence_id: input.reply_to_correspondence_id ?? null,
    };

    // Full draft_text, not an excerpt: the user must be able to read the whole letter before it is even saved
    // as a draft, and again (FINALIZE_LETTER) before it gets its official number. Telegram's own 4096-char
    // chunking (format.ts) already splits a long message across several bubbles.
    const previewText = [
      input.reply_to_correspondence_id ? "پیش‌نویس پاسخ به نامهٔ وارده — فقط پیش‌نویس ذخیره می‌شود و شمارهٔ رسمی ندارد:" : "پیش‌نویس نامهٔ صادره — فقط پیش‌نویس ذخیره می‌شود و شمارهٔ رسمی ندارد:",
      `موضوع: ${input.subject}`,
      `گیرنده: ${input.recipient_name ?? "(شرکت انتخاب‌شده)"}`,
      "متن:",
      input.draft_text,
    ].join("\n");

    return { payload: payload as unknown as Record<string, unknown>, previewText };
  },
};

const registerIncomingLetterInput = z.object({
  subject: z.string().trim().min(1, "موضوع نامه الزامی است."),
  body_summary: z.string().trim().min(1, "خلاصهٔ متن نامه الزامی است."),
  sender_name: z.string().trim().optional(),
  sender_company_id: z.string().uuid().optional(),
  external_letter_number: z.string().trim().optional(),
  external_letter_date: z.string().optional(),
  case_id: z.string().uuid().optional(),
  requires_response: z.boolean().optional(),
});

/**
 * HIGH-risk (spec §71/§37) — the ONE confirmation click drafts the
 * incoming letter, calls the existing register_incoming RPC (same
 * numbering path as the web UI's own createIncoming), and archives the
 * original photo/PDF as an attachment — via createAndRegisterIncomingCore
 * (app/actions/correspondence.ts). The original_file_base64/mime_type
 * fields are populated by the TELEGRAM HANDLER (lib/assistant/telegram/
 * handleUpdate.ts) from the actual photo/PDF bytes it downloaded — the
 * model never re-derives or re-encodes the file itself, only extracts
 * the structured fields it can read from the image/document content
 * block it was shown this turn.
 */
export const registerIncomingLetter: ActionDefinition<z.infer<typeof registerIncomingLetterInput>> = {
  name: "REGISTER_INCOMING_LETTER",
  description:
    "پیشنهاد ثبت رسمی یک نامهٔ وارده (نه ثبت قطعی — فقط پیش‌نمایش برای تأیید کاربر). از تصویر/سند نامه که کاربر فرستاده، فرستنده، موضوع، شمارهٔ نامهٔ طرف مقابل (در صورت وجود)، تاریخ، و خلاصهٔ متن (body_summary) را استخراج کن. هرگز اطلاعاتی که در تصویر/سند نیست را حدس نزن — اگر چیزی ناخوانا یا نامشخص است، از کاربر بپرس. اگر فرستنده یک شرکت شناخته‌شده است، ابتدا با SEARCH_COMPANY پیدا کن و sender_company_id را بفرست. پس از ثبت، اگر نامه نیاز به پاسخ دارد یا مهلت مشخصی دارد، در پاسخ متنی خودت (نه در همین ابزار) به کاربر بگو و پیشنهاد بده که با CREATE_FOLLOWUP_DRAFT پیگیری ثبت شود یا با CREATE_LETTER_DRAFT (با reply_to_correspondence_id) پاسخ نوشته شود — این تشخیص فقط یک پیشنهاد است، نه ثبت خودکار.",
  riskLevel: "HIGH",
  requiresConfirmation: true,
  inputSchema: registerIncomingLetterInput,
  handler: async (input, ctx) => {
    if (!input.sender_company_id && !input.sender_name) {
      throw new Error("فرستندهٔ نامه (شرکت یا نام) باید مشخص باشد.");
    }

    // ctx.turnAttachment is the actual photo/PDF bytes runChatTurn showed
    // the model this turn (lib/assistant/actions/types.ts) — never
    // re-derived or re-encoded by the model itself as a tool parameter.
    const attachment = ctx.turnAttachment;

    const payload: IncomingLetterInput = {
      subject: input.subject,
      body_summary: input.body_summary,
      sender_name: input.sender_name ?? null,
      sender_company_id: input.sender_company_id ?? null,
      external_letter_number: input.external_letter_number ?? null,
      external_letter_date: input.external_letter_date ?? null,
      case_id: input.case_id ?? null,
      requires_response: input.requires_response ?? false,
      original_file_base64: attachment?.data ?? null,
      original_file_mime_type: attachment?.mediaType ?? null,
    };

    const summaryExcerpt = input.body_summary.length > 220 ? `${input.body_summary.slice(0, 220)}…` : input.body_summary;
    const previewText = [
      "نامهٔ واردهٔ جدید — پس از تأیید بلافاصله شمارهٔ رسمی می‌گیرد:",
      `فرستنده: ${input.sender_name ?? "(شرکت انتخاب‌شده)"}`,
      `موضوع: ${input.subject}`,
      input.external_letter_number ? `شمارهٔ نامهٔ طرف مقابل: ${input.external_letter_number}` : null,
      input.external_letter_date ? `تاریخ: ${formatJalali(input.external_letter_date)}` : null,
      "خلاصه:",
      summaryExcerpt,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload: payload as unknown as Record<string, unknown>, previewText };
  },
};

const finalizeLetterInput = z.object({ correspondence_id: z.string().uuid("شناسهٔ نامه نامعتبر است.") });

/**
 * HIGH-risk (spec §8/§41): issues the OFFICIAL, irreversible number for an existing outgoing draft via the
 * existing finalize_correspondence RPC (finalizeLetterCore). The preview shows the full stored letter text
 * (read back from the DB — not what the model remembers); the proposal is only possible for the caller's own
 * draft (or an ADMIN), and finalizeLetterCore re-checks that at execute time. Confirmable ONLY with the
 * explicit button — never by a bare «باشه» (confirmation.ts).
 */
export const finalizeLetter: ActionDefinition<z.infer<typeof finalizeLetterInput>> = {
  name: "FINALIZE_LETTER",
  description:
    "پیشنهاد «صدور رسمی» یک پیش‌نویس نامهٔ صادره که قبلاً ساخته شده (گرفتن شمارهٔ رسمی؛ برگشت‌ناپذیر است — فقط پیش‌نمایش برای تأیید کاربر). correspondence_id را فقط از نتیجهٔ ساخت پیش‌نویس یا SEARCH_CORRESPONDENCE بگیر — هرگز حدس نزن. فقط وقتی کاربر صریحاً خواست نامه صادر/ارسال/شماره‌دار شود فراخوانی کن.",
  riskLevel: "HIGH",
  requiresConfirmation: true,
  inputSchema: finalizeLetterInput,
  handler: async (input, ctx) => {
    const { data: letter } = await ctx.supabase
      .from("correspondence")
      .select("id, direction, status, sequence_number, created_by, subject, draft_text, recipient_name")
      .eq("id", input.correspondence_id)
      .maybeSingle();
    if (!letter) throw new Error("نامه‌ای با این شناسه پیدا نشد.");
    if (letter.direction !== "OUTGOING" || letter.sequence_number != null || !["DRAFT", "REVIEW"].includes(letter.status)) {
      throw new Error("این نامه قابل صدور رسمی نیست — قبلاً شماره گرفته یا نامهٔ صادره نیست.");
    }
    if (letter.created_by !== ctx.userId && ctx.profile.role !== "ADMIN") {
      throw new Error("فقط سازندهٔ پیش‌نویس یا مدیر سامانه می‌تواند این نامه را صادر کند.");
    }

    const previewText = [
      "صدور رسمی نامه — شمارهٔ رسمی صادر می‌شود و این کار برگشت‌ناپذیر است؛ پس از آن نامه دیگر قابل ویرایش نیست:",
      `موضوع: ${letter.subject ?? "-"}`,
      `گیرنده: ${letter.recipient_name ?? "(شرکت انتخاب‌شده)"}`,
      "متن:",
      htmlToPlainText(letter.draft_text) || "(بدون متن)",
    ].join("\n");

    return { payload: { correspondence_id: letter.id }, previewText };
  },
};

export const correspondenceActions: ActionDefinition<any>[] = [getCorrespondence, createLetterDraft, finalizeLetter, registerIncomingLetter];

import "server-only";
import { z } from "zod";
import type { LetterDraftInput } from "@/app/actions/correspondence";
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
});

/**
 * HIGH-risk (spec §71) — the ONE confirmation click here drafts the
 * letter, calls the existing finalize_correspondence RPC, generates and
 * archives the PDF, all through createAndFinalizeLetterCore
 * (app/actions/correspondence.ts) — the exact same finalization path
 * the web UI's own two-step flow uses, never a parallel one. draft_text
 * is composed by the model itself as this tool's own parameter (spec
 * §10) — no second LLM round-trip.
 */
export const createLetterDraft: ActionDefinition<z.infer<typeof createLetterDraftInput>> = {
  name: "CREATE_LETTER_DRAFT",
  description:
    "پیشنهاد نوشتن و صدور رسمی یک نامهٔ صادره (نه ثبت قطعی — فقط پیش‌نمایش برای تأیید کاربر). متن نامه (draft_text) را خودت با لحن رسمی و حرفه‌ای اداری فارسی بنویس — کامل و آماده برای ارسال، نه خلاصه. گیرنده را ترجیحاً با SEARCH_COMPANY پیدا کن و recipient_company_id را بفرست؛ اگر شرکتی در سیستم نبود، فقط recipient_name را بفرست. هرگز گیرنده یا موضوع را حدس نزن — اگر نامشخص است بپرس. پس از تأیید کاربر، این نامه بلافاصله شمارهٔ رسمی می‌گیرد و دیگر قابل ویرایش نیست.",
  riskLevel: "HIGH",
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
    };

    const excerpt = input.draft_text.length > 220 ? `${input.draft_text.slice(0, 220)}…` : input.draft_text;
    const previewText = [
      "نامهٔ صادرهٔ جدید — پس از تأیید بلافاصله شمارهٔ رسمی می‌گیرد:",
      `موضوع: ${input.subject}`,
      `گیرنده: ${input.recipient_name ?? "(شرکت انتخاب‌شده)"}`,
      "متن:",
      excerpt,
    ].join("\n");

    return { payload: payload as unknown as Record<string, unknown>, previewText };
  },
};

export const correspondenceActions: ActionDefinition<any>[] = [getCorrespondence, createLetterDraft];

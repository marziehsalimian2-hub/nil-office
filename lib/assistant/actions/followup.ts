import "server-only";
import { z } from "zod";
import { formatJalali } from "@/lib/jalali";
import { resolveDatePhrase } from "@/lib/assistant/dates";
import type { ActionDefinition, ResultCard } from "./types";

export const listFollowups: ActionDefinition<Record<string, never>> = {
  name: "LIST_FOLLOWUPS",
  description: "لیست پیگیری‌های باز (سررسید امروز، عقب‌افتاده، آینده). بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  handler: async (_input, ctx) => {
    const { data } = await ctx.supabase.from("followups").select("id, title, due_date, status").eq("status", "OPEN").order("due_date");
    const rows = data ?? [];
    const cards: ResultCard[] = rows.slice(0, 10).map((f) => ({ kind: "followup", id: f.id, title: f.title, subtitle: formatJalali(f.due_date), href: "/followups" }));
    return { data: rows, cards };
  },
};

const createFollowupDraftInput = z.object({
  title: z.string().trim().min(1, "موضوع پیگیری الزامی است."),
  due_date_phrase: z.string().trim().min(1, "تاریخ پیگیری الزامی است."),
  company_id: z.string().uuid().optional(),
  note: z.string().trim().optional(),
});

export const createFollowupDraft: ActionDefinition<z.infer<typeof createFollowupDraftInput>> = {
  name: "CREATE_FOLLOWUP_DRAFT",
  description:
    "پیشنهاد ثبت یک پیگیری جدید (نه ثبت قطعی — فقط پیش‌نمایش برای تأیید کاربر). company_id را فقط اگر قبلاً با SEARCH_COMPANY پیدا کرده‌اید بفرستید. due_date_phrase می‌تواند «فردا»، «۳ روز دیگر»، یا یک تاریخ مشخص باشد و الزامی است.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: createFollowupDraftInput,
  handler: async (input, ctx) => {
    const resolved = resolveDatePhrase(input.due_date_phrase);
    if ("error" in resolved) throw new Error(resolved.error);

    const payload = {
      title: input.title,
      due_date: resolved.iso,
      company_id: input.company_id ?? null,
      assigned_to: ctx.userId,
      note: input.note ?? null,
      status: "OPEN",
    };

    const previewText = ["پیگیری جدید:", `موضوع: ${input.title}`, `تاریخ: ${formatJalali(resolved.iso)} (${resolved.explanation})`, input.note ? `یادداشت: ${input.note}` : null]
      .filter(Boolean)
      .join("\n");

    return { payload, previewText };
  },
};

export const followupActions: ActionDefinition<any>[] = [listFollowups, createFollowupDraft];

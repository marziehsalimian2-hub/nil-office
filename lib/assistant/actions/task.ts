import "server-only";
import { z } from "zod";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { resolveDatePhrase } from "@/lib/assistant/dates";
import type { ActionDefinition, ResultCard } from "./types";

export const listMyTasks: ActionDefinition<{ include_done?: boolean }> = {
  name: "LIST_MY_TASKS",
  description: "لیست کارهای واگذارشده به کاربر فعلی. به‌صورت پیش‌فرض کارهای انجام‌شده/لغوشده را نشان نمی‌دهد.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ include_done: z.boolean().optional() }),
  handler: async (input, ctx) => {
    let q = ctx.supabase.from("tasks").select("id, title, status, priority, due_date, project_id").eq("assigned_to", ctx.userId).order("due_date", { ascending: true, nullsFirst: false });
    if (!input.include_done) q = q.not("status", "in", "(DONE,CANCELLED)");
    const { data } = await q.limit(30);
    const rows = data ?? [];
    const cards: ResultCard[] = rows.map((t) => ({ kind: "task", id: t.id, title: t.title, subtitle: t.due_date ? formatJalali(t.due_date) : undefined, href: `/tasks/${t.id}` }));
    return { data: rows, cards };
  },
};

export const getTask: ActionDefinition<{ task_id: string }> = {
  name: "GET_TASK",
  description: "جزئیات یک کار مشخص با شناسه. ابتدا با SEARCH_TASKS یا LIST_MY_TASKS شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ task_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase.from("tasks").select("*").eq("id", input.task_id).single();
    if (!data) return { data: { note: "کاری با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return { data, cards: [{ kind: "task", id: data.id, title: data.title, href: `/tasks/${data.id}` }] };
  },
};

const createTaskDraftInput = z.object({
  title: z.string().trim().min(1, "عنوان کار الزامی است."),
  due_date_phrase: z.string().trim().optional(),
  project_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  description: z.string().trim().optional(),
});

export const createTaskDraft: ActionDefinition<z.infer<typeof createTaskDraftInput>> = {
  name: "CREATE_TASK_DRAFT",
  description:
    "پیشنهاد ایجاد یک کار جدید برای کاربر فعلی (نه ثبت قطعی — فقط یک پیش‌نمایش برای تأیید کاربر می‌سازد). project_id/company_id را فقط اگر قبلاً با SEARCH_PROJECT/SEARCH_COMPANY پیدا کرده‌اید بفرستید؛ حدس نزنید. due_date_phrase می‌تواند «فردا»، «۳ روز دیگر»، یا یک تاریخ مشخص باشد.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: createTaskDraftInput,
  handler: async (input, ctx) => {
    let dueDate: string | null = null;
    let dueDateExplanation = "بدون مهلت";
    if (input.due_date_phrase) {
      const resolved = resolveDatePhrase(input.due_date_phrase);
      if ("error" in resolved) throw new Error(resolved.error);
      dueDate = resolved.iso;
      dueDateExplanation = `${formatJalali(resolved.iso)} (${resolved.explanation})`;
    }

    const payload = {
      title: input.title,
      description: input.description ?? null,
      project_id: input.project_id ?? null,
      company_id: input.company_id ?? null,
      assigned_to: ctx.userId,
      status: "TODO",
      priority: "NORMAL",
      due_date: dueDate,
    };

    const previewText = [
      "کار جدید:",
      `عنوان: ${input.title}`,
      `مهلت: ${dueDateExplanation}`,
      input.description ? `توضیح: ${input.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload, previewText };
  },
};

export const taskActions: ActionDefinition<any>[] = [listMyTasks, getTask, createTaskDraft];

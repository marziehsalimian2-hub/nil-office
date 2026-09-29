import "server-only";
import { z } from "zod";
import { CURRENCY } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import { resolveDatePhrase } from "@/lib/assistant/dates";
import type { ActionContext, ActionDefinition, ResultCard } from "./types";
import type { ServiceLedgerClaimableAmountRow } from "@/lib/types/database";

/** Resolves a company_id (already found via SEARCH_COMPANY — never guessed) to its Client Service File. Throws a clear Persian message if none exists yet — Phase 1 only lets a human open one from the company's own "خدمات" tab; the Assistant never creates the file itself. Exported for reuse by serviceLedgerReports.ts (Phase 6). */
export async function requireClientServiceFile(ctx: ActionContext, companyId: string) {
  const { data } = await ctx.supabase.from("client_service_files").select("id, default_currency").eq("company_id", companyId).single();
  if (!data) throw new Error("برای این شرکت هنوز پروندهٔ خدمات مشتری باز نشده است — ابتدا از تب «خدمات» در صفحهٔ شرکت آن را باز کنید.");
  return data as { id: string; default_currency: string };
}

async function resolveServiceCategoryId(ctx: ActionContext, code: string): Promise<string> {
  const { data } = await ctx.supabase.from("service_categories").select("id").eq("code", code).eq("is_active", true).maybeSingle();
  if (!data) throw new Error(`دسته‌بندی خدمت «${code}» شناخته‌شده نیست.`);
  return data.id as string;
}

export const getClientServiceSummary: ActionDefinition<{ company_id: string }> = {
  name: "GET_CLIENT_SERVICE_SUMMARY",
  description:
    "خلاصهٔ پروندهٔ خدمات یک مشتری: وضعیت پرونده، مسئول رابطه، و مبالغ قابل مطالبه (حق‌الزحمه + زمان قابل مطالبه + هزینهٔ قابل بازپرداخت) به تفکیک واحد پول. ورودی company_id را باید قبلاً از SEARCH_COMPANY گرفته باشید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است.") }),
  handler: async (input, ctx) => {
    const { data: file } = await ctx.supabase.from("client_service_files").select("*").eq("company_id", input.company_id).maybeSingle();
    if (!file) return { data: { note: "برای این شرکت پروندهٔ خدمات مشتری باز نشده است." } };

    const { data: company } = await ctx.supabase.from("companies").select("id, legal_name").eq("id", input.company_id).single();
    const { data: summary } = await ctx.supabase.rpc("get_client_service_claimable_summary", { p_client_service_file_id: file.id });

    const cards: ResultCard[] = company ? [{ kind: "company", id: company.id, title: company.legal_name, href: `/companies/${company.id}` }] : [];
    return { data: { file, claimableSummary: (summary ?? []) as ServiceLedgerClaimableAmountRow[] }, cards };
  },
};

export const listClientServices: ActionDefinition<{ company_id: string }> = {
  name: "LIST_CLIENT_SERVICES",
  description: "فهرست قراردادهای نحوهٔ ارائهٔ خدمات (Service Arrangements) و خدمات اخیر ثبت‌شده برای یک مشتری. ورودی company_id را از SEARCH_COMPANY بگیرید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است.") }),
  handler: async (input, ctx) => {
    const { data: file } = await ctx.supabase.from("client_service_files").select("id").eq("company_id", input.company_id).maybeSingle();
    if (!file) return { data: { note: "برای این شرکت پروندهٔ خدمات مشتری باز نشده است." } };

    const [{ data: arrangements }, { data: recentEntries }] = await Promise.all([
      ctx.supabase.from("service_arrangements").select("id, title, arrangement_type, status").eq("client_service_file_id", file.id),
      ctx.supabase
        .from("service_entries")
        .select("id, title, service_date, status, billing_status, service_categories(name)")
        .eq("client_service_file_id", file.id)
        .order("service_date", { ascending: false })
        .limit(15),
    ]);

    return { data: { arrangements: arrangements ?? [], recentEntries: recentEntries ?? [] } };
  },
};

export const searchServiceEntries: ActionDefinition<{ query: string; company_id?: string }> = {
  name: "SEARCH_SERVICE_ENTRIES",
  description: "جست‌وجوی خدمات ثبت‌شده بر اساس عنوان یا شرح. اختیاری: فیلتر بر اساس company_id (از SEARCH_COMPANY).",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ query: z.string().trim().min(1, "عبارت جست‌وجو الزامی است."), company_id: z.string().uuid().optional() }),
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("service_entries")
      .select("id, title, description, service_date, status, billing_status, client_service_files(company_id)")
      .or(`title.ilike.%${input.query}%,description.ilike.%${input.query}%`)
      .order("service_date", { ascending: false })
      .limit(20);
    if (input.company_id) {
      const { data: file } = await ctx.supabase.from("client_service_files").select("id").eq("company_id", input.company_id).maybeSingle();
      if (!file) return { data: { note: "برای این شرکت پروندهٔ خدمات مشتری باز نشده است." } };
      q = q.eq("client_service_file_id", file.id);
    }
    const { data } = await q;
    return { data: data ?? [] };
  },
};

/** Read-only — fits entirely inside Phase 1's own data model (no billing-batch concept needed): "ready to bill" work that hasn't been through a billing batch yet. */
export const getUnbilledWork: ActionDefinition<{ company_id?: string }> = {
  name: "GET_UNBILLED_WORK",
  description: "فهرست خدماتی که قابل مطالبه‌اند اما هنوز وارد صورتحساب رسمی نشده‌اند (billing_status: BILLABLE یا READY_TO_BILL). اختیاری: فیلتر بر اساس company_id.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid().optional() }),
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("service_entries")
      .select("id, title, service_date, billing_status, service_fee, currency, client_service_files(company_id, companies(legal_name))")
      .in("billing_status", ["BILLABLE", "READY_TO_BILL"])
      .order("service_date", { ascending: false })
      .limit(50);
    if (input.company_id) {
      const { data: file } = await ctx.supabase.from("client_service_files").select("id").eq("company_id", input.company_id).maybeSingle();
      if (!file) return { data: { note: "برای این شرکت پروندهٔ خدمات مشتری باز نشده است." } };
      q = q.eq("client_service_file_id", file.id);
    }
    const { data } = await q;
    return { data: data ?? [] };
  },
};

export const getReimbursableExpenses: ActionDefinition<{ company_id?: string }> = {
  name: "GET_REIMBURSABLE_EXPENSES",
  description: "فهرست هزینه‌های قابل بازپرداخت از مشتری که هنوز تسویه نشده‌اند. اختیاری: فیلتر بر اساس company_id.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid().optional() }),
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("expenses")
      .select("id, description, amount, currency, billing_status, expense_date, service_entries(client_service_file_id, client_service_files(company_id, companies(legal_name)))")
      .eq("is_reimbursable", true)
      .neq("billing_status", "SETTLED")
      .order("expense_date", { ascending: false })
      .limit(50);
    const { data } = await q;
    let rows = data ?? [];
    if (input.company_id) {
      const { data: file } = await ctx.supabase.from("client_service_files").select("id").eq("company_id", input.company_id).maybeSingle();
      if (!file) return { data: { note: "برای این شرکت پروندهٔ خدمات مشتری باز نشده است." } };
      rows = rows.filter((r) => {
        const se = Array.isArray(r.service_entries) ? r.service_entries[0] : r.service_entries;
        return se?.client_service_file_id === file.id;
      });
    }
    return { data: rows };
  },
};

const createServiceEntryDraftInput = z.object({
  company_id: z.string().uuid(),
  title: z.string().trim().min(1, "عنوان خدمت الزامی است."),
  service_category_code: z.string().trim().min(1, "دسته‌بندی خدمت را مشخص کنید."),
  service_date_phrase: z.string().trim().optional(),
  duration_minutes: z.number().min(1).optional(),
  expense_amount: z.number().min(0).optional(),
  expense_description: z.string().trim().optional(),
  currency: z.enum(CURRENCY).optional(),
});

/**
 * The single "quick log" action — mirrors the web Quick Add's combined
 * insert (service entry + optional time + optional expense) so a
 * one-message description like spec §41's own example ("امروز برای
 * شرکت X پیگیری ثبت شرکت انجام دادم، یک ساعت و نیم زمان برد و دو میلیون
 * تومان هم هزینه پرداخت کردم") becomes ONE preview + ONE confirmation,
 * not three separate ones — this codebase's orchestrator only tracks a
 * single pendingAction per turn (lib/assistant/orchestrator.ts), so
 * three separate confirmable proposals in one turn isn't something the
 * current architecture could present cleanly anyway. ADD_TIME_ENTRY_DRAFT
 * and ADD_SERVICE_EXPENSE_DRAFT below are for adding a time/expense
 * entry to an EXISTING service entry the user already knows the id of
 * (e.g. from LIST_CLIENT_SERVICES/SEARCH_SERVICE_ENTRIES), not for this
 * combined first-time-logging flow.
 */
export const createServiceEntryDraft: ActionDefinition<z.infer<typeof createServiceEntryDraftInput>> = {
  name: "CREATE_SERVICE_ENTRY_DRAFT",
  description:
    "پیشنهاد ثبت یک خدمت جدید برای مشتری (نه ثبت قطعی — فقط پیش‌نمایش برای تأیید کاربر). اگر کاربر مدت‌زمان یا هزینه هم ذکر کرده، duration_minutes/expense_amount را همراه همین درخواست بفرستید تا هر سه با هم و در یک تأیید ثبت شوند. company_id را فقط اگر قبلاً با SEARCH_COMPANY پیدا کرده‌اید بفرستید. service_category_code باید یکی از کدهای دسته‌بندی خدمت باشد (مثلاً CONSULTING، FOLLOW_UP، CORRESPONDENCE). service_date_phrase می‌تواند «امروز»، «دیروز» یا یک تاریخ مشخص باشد؛ اگر گفته نشود «امروز» فرض می‌شود.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: createServiceEntryDraftInput,
  handler: async (input, ctx) => {
    const file = await requireClientServiceFile(ctx, input.company_id);
    const categoryId = await resolveServiceCategoryId(ctx, input.service_category_code);

    let serviceDate = new Date().toISOString().slice(0, 10);
    let dateExplanation = "امروز";
    if (input.service_date_phrase) {
      const resolved = resolveDatePhrase(input.service_date_phrase);
      if ("error" in resolved) throw new Error(resolved.error);
      serviceDate = resolved.iso;
      dateExplanation = `${formatJalali(resolved.iso)} (${resolved.explanation})`;
    }

    const currency = input.currency ?? (file.default_currency as (typeof CURRENCY)[number]);

    const payload = {
      client_service_file_id: file.id,
      service_category_id: categoryId,
      title: input.title,
      service_date: serviceDate,
      performed_by: ctx.userId,
      duration_minutes: input.duration_minutes,
      currency,
      expense_amount: input.expense_amount,
      expense_description: input.expense_description,
    };

    const previewText = [
      "خدمت جدید:",
      `عنوان: ${input.title}`,
      `تاریخ: ${dateExplanation}`,
      input.duration_minutes ? `مدت‌زمان: ${input.duration_minutes} دقیقه` : null,
      input.expense_amount ? `هزینه: ${input.expense_amount.toLocaleString("en-US")} ${currency}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload, previewText };
  },
};

const addTimeEntryDraftInput = z.object({
  service_entry_id: z.string().uuid("شناسهٔ خدمت را مشخص کنید — ابتدا با LIST_CLIENT_SERVICES یا SEARCH_SERVICE_ENTRIES پیدا کنید."),
  duration_minutes: z.number().min(1, "مدت‌زمان باید حداقل ۱ دقیقه باشد."),
  work_date_phrase: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

export const addTimeEntryDraft: ActionDefinition<z.infer<typeof addTimeEntryDraftInput>> = {
  name: "ADD_TIME_ENTRY_DRAFT",
  description:
    "پیشنهاد ثبت زمان صرف‌شده برای یک خدمتِ از قبل ثبت‌شده (نه ثبت قطعی — فقط پیش‌نمایش). service_entry_id را ابتدا با LIST_CLIENT_SERVICES یا SEARCH_SERVICE_ENTRIES پیدا کنید — هرگز حدس نزنید.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: addTimeEntryDraftInput,
  handler: async (input, ctx) => {
    let workDate = new Date().toISOString().slice(0, 10);
    let dateExplanation = "امروز";
    if (input.work_date_phrase) {
      const resolved = resolveDatePhrase(input.work_date_phrase);
      if ("error" in resolved) throw new Error(resolved.error);
      workDate = resolved.iso;
      dateExplanation = `${formatJalali(resolved.iso)} (${resolved.explanation})`;
    }

    const payload = {
      service_entry_id: input.service_entry_id,
      performed_by: ctx.userId,
      work_date: workDate,
      duration_minutes: input.duration_minutes,
      description: input.description ?? null,
      billable: true,
    };

    const previewText = ["ثبت زمان:", `مدت‌زمان: ${input.duration_minutes} دقیقه`, `تاریخ: ${dateExplanation}`, input.description ? `شرح: ${input.description}` : null]
      .filter(Boolean)
      .join("\n");

    return { payload, previewText };
  },
};

const addServiceExpenseDraftInput = z.object({
  service_entry_id: z.string().uuid("شناسهٔ خدمت را مشخص کنید — ابتدا با LIST_CLIENT_SERVICES یا SEARCH_SERVICE_ENTRIES پیدا کنید."),
  description: z.string().trim().min(1, "شرح هزینه الزامی است."),
  amount: z.number().min(0.01, "مبلغ باید بزرگ‌تر از صفر باشد."),
  currency: z.enum(CURRENCY).optional(),
  is_reimbursable: z.boolean().optional(),
});

export const addServiceExpenseDraft: ActionDefinition<z.infer<typeof addServiceExpenseDraftInput>> = {
  name: "ADD_SERVICE_EXPENSE_DRAFT",
  description:
    "پیشنهاد ثبت هزینه برای یک خدمتِ از قبل ثبت‌شده (نه ثبت قطعی — فقط پیش‌نمایش). service_entry_id را ابتدا با LIST_CLIENT_SERVICES یا SEARCH_SERVICE_ENTRIES پیدا کنید. اگر مشخص نیست این هزینه باید از مشتری دریافت شود یا نه، از کاربر بپرسید — حدس نزنید.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: addServiceExpenseDraftInput,
  handler: async (input) => {
    const currency = input.currency ?? "IRR";
    const isReimbursable = input.is_reimbursable ?? false;
    const payload = {
      service_entry_id: input.service_entry_id,
      expense_date: new Date().toISOString().slice(0, 10),
      description: input.description,
      amount: input.amount,
      currency,
      paid_by: "NIL",
      is_reimbursable: isReimbursable,
      reimbursable_amount: isReimbursable ? input.amount : null,
      billing_status: "NON_BILLABLE",
    };

    const previewText = [
      "ثبت هزینه:",
      `شرح: ${input.description}`,
      `مبلغ: ${input.amount.toLocaleString("en-US")} ${currency}`,
      `قابل بازپرداخت از مشتری: ${isReimbursable ? "بله" : "خیر"}`,
    ].join("\n");

    return { payload, previewText };
  },
};

export const serviceLedgerActions: ActionDefinition<any>[] = [
  getClientServiceSummary,
  listClientServices,
  searchServiceEntries,
  getUnbilledWork,
  getReimbursableExpenses,
  createServiceEntryDraft,
  addTimeEntryDraft,
  addServiceExpenseDraft,
];

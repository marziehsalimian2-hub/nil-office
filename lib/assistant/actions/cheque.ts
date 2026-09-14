import "server-only";
import { z } from "zod";
import { formatJalali } from "@/lib/jalali";
import { resolveDatePhrase } from "@/lib/assistant/dates";
import { amountToPersianWords } from "@/lib/cheque/amountToWords";
import type { ChequeDraftInput } from "@/app/actions/cheques";
import type { ActionDefinition, ResultCard } from "./types";

const hasChequeAccess = (p: { role: string; cheque_role: string | null }) => p.role === "ADMIN" || p.cheque_role != null;

const CURRENCY_CODES = ["IRR", "TOMAN", "USD", "EUR", "AED", "TRY", "CNY"] as const;

/** Both read actions below reuse the exact "active, not yet resolved" notion the Attention Engine's cheque rules use (lib/dashboard/attention.ts) — one definition of "still open", not a parallel one. */
const ACTIVE_STATUSES = "(DRAFT,CLEARED,RETURNED,CANCELLED,VOID)"; // NOT IN this set == active

export const searchCheques: ActionDefinition<{
  direction?: "PAYABLE" | "RECEIVABLE";
  status?: string;
  counterparty_name?: string;
  cheque_number?: string;
}> = {
  name: "SEARCH_CHEQUES",
  description: "جست‌وجوی چک‌ها بر اساس جهت (دریافتی/پرداختی)، وضعیت، نام طرف حساب یا شمارهٔ چک.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  requiredAccess: hasChequeAccess,
  inputSchema: z.object({
    direction: z.enum(["PAYABLE", "RECEIVABLE"]).optional(),
    status: z.string().optional(),
    counterparty_name: z.string().optional(),
    cheque_number: z.string().optional(),
  }),
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("cheques")
      .select("id, display_number, cheque_number, direction, status, amount, currency_code, cheque_date, counterparty_name_snapshot")
      .order("cheque_date", { ascending: true });
    if (input.direction) q = q.eq("direction", input.direction);
    if (input.status) q = q.eq("status", input.status);
    if (input.counterparty_name) q = q.ilike("counterparty_name_snapshot", `%${input.counterparty_name}%`);
    if (input.cheque_number) q = q.ilike("cheque_number", `%${input.cheque_number}%`);
    const { data } = await q.limit(30);
    const rows = data ?? [];
    const cards: ResultCard[] = rows.map((c) => ({
      kind: "cheque",
      id: c.id,
      title: `چک ${c.display_number ?? c.cheque_number} — ${c.counterparty_name_snapshot}`,
      subtitle: `${formatJalali(c.cheque_date)} — ${c.status}`,
      href: `/cheques/${c.id}`,
    }));
    return { data: rows, cards };
  },
};

export const getCheque: ActionDefinition<{ cheque_id: string }> = {
  name: "GET_CHEQUE",
  description: "جزئیات یک چک مشخص با شناسه، شامل مبلغ به حروف. ابتدا با SEARCH_CHEQUES شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  requiredAccess: hasChequeAccess,
  inputSchema: z.object({ cheque_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase.from("cheques").select("*").eq("id", input.cheque_id).single();
    if (!data) return { data: { note: "چکی با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return {
      data,
      cards: [{ kind: "cheque", id: data.id, title: `چک ${data.display_number ?? data.cheque_number}`, href: `/cheques/${data.id}` }],
    };
  },
};

export const getChequesDue: ActionDefinition<{ within_days?: number }> = {
  name: "GET_CHEQUES_DUE",
  description: "لیست چک‌های سررسیدشده و در حال سررسید (هر دو جهت دریافتی/پرداختی)، بر اساس تاریخ چک. within_days پیش‌فرض ۷ روز است.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  requiredAccess: hasChequeAccess,
  // NOT .positive() — zod-to-json-schema renders it as the old draft-04
  // {exclusiveMinimum: true, minimum: 0} shape, which Anthropic's tool
  // schema validator rejects outright (draft 2020-12 requires
  // exclusiveMinimum to be a number) — and since all tool schemas are
  // sent in one request, a single bad one fails the ENTIRE chat turn,
  // not just this action. .min(1) renders as the clean {minimum: 1}.
  inputSchema: z.object({ within_days: z.number().int().min(1).max(365).optional() }),
  handler: async (input, ctx) => {
    const days = input.within_days ?? 7;
    const today = new Date().toISOString().slice(0, 10);
    const window = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const { data } = await ctx.supabase
      .from("cheques")
      .select("id, display_number, cheque_number, direction, status, amount, currency_code, cheque_date, counterparty_name_snapshot")
      .not("status", "in", ACTIVE_STATUSES)
      .lte("cheque_date", window)
      .order("cheque_date", { ascending: true })
      .limit(30);
    const rows = data ?? [];
    const cards: ResultCard[] = rows.map((c) => ({
      kind: "cheque",
      id: c.id,
      title: `چک ${c.display_number ?? c.cheque_number} — ${c.counterparty_name_snapshot}`,
      subtitle: c.cheque_date < today ? "سررسید گذشته" : formatJalali(c.cheque_date),
      href: `/cheques/${c.id}`,
    }));
    return { data: rows, cards };
  },
};

export const getChequeBookStatus: ActionDefinition<{ cheque_book_id: string }> = {
  name: "GET_CHEQUE_BOOK_STATUS",
  description: "وضعیت یک دسته‌چک: تعداد برگه‌ها، تعداد استفاده‌شده و باقی‌مانده.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  requiredAccess: hasChequeAccess,
  inputSchema: z.object({ cheque_book_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { data: book } = await ctx.supabase.from("cheque_books").select("*").eq("id", input.cheque_book_id).single();
    if (!book) return { data: { note: "دسته‌چکی با این شناسه پیدا نشد یا دسترسی ندارید." } };
    const { count } = await ctx.supabase
      .from("cheques")
      .select("id", { count: "exact", head: true })
      .eq("cheque_book_id", input.cheque_book_id);
    const used = count ?? 0;
    return {
      data: { ...book, leaves_used: used, leaves_remaining: book.leaves_count - used },
      cards: [{ kind: "cheque", id: book.id, title: `دسته‌چک ${book.book_identifier}`, subtitle: `${used} از ${book.leaves_count} برگه استفاده‌شده`, href: `/cheques/books/${book.id}` }],
    };
  },
};

const createChequeDraftInput = z.object({
  direction: z.enum(["PAYABLE", "RECEIVABLE"]),
  // NOT .positive() — see the GET_CHEQUES_DUE note above; amountToPersianWords
  // below already rejects amount <= 0 with a clear Persian error.
  amount: z.number().min(0),
  currency_code: z.enum(CURRENCY_CODES).optional(),
  cheque_date_phrase: z.string().trim().min(1, "تاریخ چک الزامی است."),
  cheque_number: z.string().trim().min(1, "شمارهٔ چک الزامی است."),
  cheque_book_id: z.string().uuid().optional(),
  sayad_id: z.string().trim().optional(),
  counterparty_company_id: z.string().uuid().optional(),
  counterparty_name: z.string().trim().optional(),
  drawer_bank_name: z.string().trim().optional(),
  drawer_branch: z.string().trim().optional(),
  drawer_account_number: z.string().trim().optional(),
  purpose: z.string().trim().optional(),
  description: z.string().trim().optional(),
  company_id: z.string().uuid().optional(),
  contract_id: z.string().uuid().optional(),
  sales_document_id: z.string().uuid().optional(),
});

export const createChequeDraft: ActionDefinition<z.infer<typeof createChequeDraftInput>> = {
  name: "CREATE_CHEQUE_DRAFT",
  description:
    "پیشنهاد ثبت یک چک جدید (دریافتی یا پرداختی) — نه ثبت قطعی، فقط یک پیش‌نمایش برای تأیید کاربر. برای چک پرداختی، cheque_book_id را فقط اگر قبلاً با GET_CHEQUE_BOOK_STATUS پیدا کرده‌اید بفرستید. برای چک دریافتی، drawer_bank_name الزامی است. counterparty_company_id/company_id/contract_id را فقط اگر قبلاً با SEARCH_COMPANY/SEARCH پیدا کرده‌اید بفرستید؛ حدس نزنید. این عملیات هرگز به‌تنهایی چک را صادر یا چاپ نمی‌کند.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  requiredAccess: (p) => p.role === "ADMIN" || p.cheque_role === "CREATE" || p.cheque_role === "APPROVE" || p.cheque_role === "ADMIN",
  inputSchema: createChequeDraftInput,
  handler: async (input) => {
    const resolved = resolveDatePhrase(input.cheque_date_phrase);
    if ("error" in resolved) throw new Error(resolved.error);

    if (input.direction === "PAYABLE" && !input.cheque_book_id) {
      throw new Error("برای چک پرداختی، دسته‌چک باید مشخص باشد.");
    }
    if (input.direction === "RECEIVABLE" && !input.drawer_bank_name) {
      throw new Error("برای چک دریافتی، نام بانک صادرکننده باید مشخص باشد.");
    }
    if (!input.counterparty_company_id && !input.counterparty_name) {
      throw new Error("طرف حساب (ذی‌نفع یا صادرکننده) باید مشخص باشد.");
    }

    const amountRounded = Math.round(input.amount);
    const currencyCode = input.currency_code ?? "IRR";
    let amountWords: string;
    try {
      amountWords = amountToPersianWords(amountRounded, currencyCode);
    } catch {
      throw new Error("مبلغ واردشده نامعتبر است.");
    }

    const payload: ChequeDraftInput = {
      direction: input.direction,
      amount: amountRounded,
      currency_code: currencyCode,
      cheque_date: resolved.iso,
      cheque_number: input.cheque_number,
      cheque_book_id: input.cheque_book_id ?? null,
      sayad_id: input.sayad_id ?? null,
      counterparty_company_id: input.counterparty_company_id ?? null,
      counterparty_name: input.counterparty_name ?? null,
      drawer_bank_name: input.drawer_bank_name ?? null,
      drawer_branch: input.drawer_branch ?? null,
      drawer_account_number: input.drawer_account_number ?? null,
      purpose: input.purpose ?? null,
      description: input.description ?? null,
      company_id: input.company_id ?? null,
      contract_id: input.contract_id ?? null,
      sales_document_id: input.sales_document_id ?? null,
    };

    const previewText = [
      `چک ${input.direction === "PAYABLE" ? "پرداختی" : "دریافتی"} جدید:`,
      `طرف حساب: ${input.counterparty_name ?? "(شرکت انتخاب‌شده)"}`,
      `مبلغ: ${amountWords}`,
      `تاریخ: ${formatJalali(resolved.iso)} (${resolved.explanation})`,
      input.purpose ? `بابت: ${input.purpose}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload: payload as unknown as Record<string, unknown>, previewText };
  },
};

const prepareChequePrintInput = z.object({ cheque_id: z.string().uuid() });

export const prepareChequePrint: ActionDefinition<z.infer<typeof prepareChequePrintInput>> = {
  name: "PREPARE_CHEQUE_PRINT",
  description:
    "پیشنهاد آماده‌سازی یک چک پرداختیِ پیش‌نویس برای چاپ (تغییر وضعیت به «آماده‌شده»). این عملیات هرگز چک را چاپ، صادر یا تحویل نمی‌کند — چاپ فیزیکی و صدور همیشه یک عملیات کنترل‌شده و جداگانه در خود NIL Office است.",
  // MEDIUM, not HIGH/CRITICAL — this registry deliberately wires up
  // nothing HIGH/CRITICAL (see registry.ts's own banner comment): actual
  // issuance/printing has no tool definition here at all (spec §42/§43),
  // and this action only stages a reversible, non-money-moving status
  // step, one tier below that line, not a final/authoritative operation.
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  requiredAccess: (p) => p.role === "ADMIN" || p.cheque_role === "CREATE" || p.cheque_role === "APPROVE" || p.cheque_role === "ADMIN",
  inputSchema: prepareChequePrintInput,
  handler: async (input) => {
    return {
      payload: { cheque_id: input.cheque_id },
      previewText: "آماده‌سازی این چک برای چاپ (وضعیت به «آماده‌شده» تغییر می‌کند؛ چاپ فیزیکی جداگانه و از داخل NIL Office انجام می‌شود).",
    };
  },
};

export const chequeActions: ActionDefinition<any>[] = [searchCheques, getCheque, getChequesDue, getChequeBookStatus, createChequeDraft, prepareChequePrint];

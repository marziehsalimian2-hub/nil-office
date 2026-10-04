import "server-only";
import { z } from "zod";
import { CURRENCY, CURRENCY_LABEL } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import type { InvoiceDraftInput } from "@/app/actions/invoices";
import { canCreateInvoice, canApproveInvoice } from "./access";
import type { ActionDefinition } from "./types";

const invoiceItemInput = z.object({
  description: z.string().trim().min(1, "شرح ردیف الزامی است."),
  // NOT .positive() — zod-to-json-schema renders it as the old draft-04
  // {exclusiveMinimum: true, minimum: 0} shape, which Anthropic's tool
  // schema validator rejects (draft 2020-12 requires exclusiveMinimum to
  // be a number) — and since all tool schemas go in one request, a
  // single bad one fails the ENTIRE chat turn, not just this action.
  // .min(0) renders cleanly as {minimum: 0}; true positivity is checked
  // in the handler below instead.
  quantity: z.number().min(0),
  unit_price: z.number().min(0, "قیمت واحد نمی‌تواند منفی باشد."),
  unit: z.string().trim().optional(),
  discount_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
});

const createInvoiceDraftInput = z.object({
  type: z.enum(["INVOICE", "PROFORMA"]),
  company_id: z.string().uuid(),
  items: z.array(invoiceItemInput).min(1, "حداقل یک ردیف کالا/خدمت لازم است."),
  currency_code: z.enum(CURRENCY).optional(),
  payment_terms: z.string().trim().optional(),
  validity_date: z.string().optional(),
  contract_id: z.string().uuid().optional(),
  notes: z.string().trim().optional(),
});

/**
 * Preview-only total — mirrors the SAME arithmetic the DB's generated
 * columns / tg_sales_document_items_rollup trigger (0031) will compute
 * from the identical row values, but this number is never written
 * anywhere; it exists purely so the user sees a total before confirming
 * (spec §19). The DB's own computation after insert is the only
 * authoritative total (spec §18 — the LLM never sources it).
 */
function computePreviewTotal(items: z.infer<typeof invoiceItemInput>[]) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const it of items) {
    subtotal += it.quantity * it.unit_price;
    discount += it.discount_amount ?? 0;
    tax += it.tax_amount ?? 0;
  }
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/**
 * MEDIUM-risk since the Internal Assistant v1.0 hardening (spec §9/§73): confirming creates ONLY a DRAFT
 * sales_document + its items (createInvoiceDraftCore, app/actions/invoices.ts) — no status change, no official
 * number. Issuing is the separate, stronger ISSUE_SALES_DOCUMENT confirmation below. No arithmetic happens here
 * or in that core; totals come only from the DB (spec §18). company_id is required — never guessed (spec §17) —
 * resolve it with SEARCH_COMPANY first.
 */
export const createInvoiceDraft: ActionDefinition<z.infer<typeof createInvoiceDraftInput>> = {
  name: "CREATE_INVOICE_DRAFT",
  description:
    "پیشنهاد ساخت «پیش‌نویس» یک فاکتور یا پیش‌فاکتور (نه ثبت قطعی و نه صدور رسمی — فقط پیش‌نمایش برای تأیید کاربر؛ پس از تأیید فقط یک پیش‌نویس بدون شمارهٔ رسمی ذخیره می‌شود). company_id را فقط اگر قبلاً با SEARCH_COMPANY پیدا کرده‌اید بفرستید — هرگز حدس نزنید. اگر مشتری، تعداد، قیمت واحد یا واحد پول مشخص نیست، از کاربر بپرسید، پیشنهاد ندهید. مبلغ کل را خودت محاسبه نکن — فقط ردیف‌های خام (تعداد، قیمت واحد، تخفیف، مالیات) را بفرست. صدور رسمی (گرفتن شمارهٔ رسمی) مرحلهٔ جداگانه‌ای است: فقط اگر کاربر صریحاً خواست، با ISSUE_SALES_DOCUMENT پیشنهاد بده — هرگز نگو سند شماره گرفته مگر وقتی ISSUE_SALES_DOCUMENT واقعاً تأیید و اجرا شده باشد.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  // CREATE tier is enough for a draft (can_create_invoice()); issuing needs APPROVE (ISSUE_SALES_DOCUMENT).
  requiredAccess: canCreateInvoice,
  inputSchema: createInvoiceDraftInput,
  handler: async (input) => {
    if (input.items.some((it) => it.quantity <= 0)) {
      throw new Error("تعداد هر ردیف باید بزرگ‌تر از صفر باشد.");
    }

    const currency = input.currency_code ?? "IRR";
    const payload: InvoiceDraftInput = {
      type: input.type,
      company_id: input.company_id,
      items: input.items,
      currency_code: currency,
      payment_terms: input.payment_terms ?? null,
      validity_date: input.validity_date ?? null,
      contract_id: input.contract_id ?? null,
      notes: input.notes ?? null,
    };

    const totals = computePreviewTotal(input.items);
    const itemLines = input.items.map(
      (it) => `- ${it.description}: ${toFaDigits(it.quantity)} ${it.unit ?? ""} × ${toFaDigits(it.unit_price.toLocaleString("en-US"))}`,
    );
    const previewText = [
      `پیش‌نویس ${input.type === "INVOICE" ? "فاکتور" : "پیش‌فاکتور"} — فقط پیش‌نویس ذخیره می‌شود و شمارهٔ رسمی ندارد:`,
      ...itemLines,
      `جمع کل: ${toFaDigits(totals.total.toLocaleString("en-US"))} ${CURRENCY_LABEL[currency]}`,
      input.payment_terms ? `شرایط پرداخت: ${input.payment_terms}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload: payload as unknown as Record<string, unknown>, previewText };
  },
};

const issueSalesDocumentInput = z.object({ sales_document_id: z.string().uuid("شناسهٔ سند نامعتبر است.") });

/**
 * HIGH-risk (spec §9/§41): issues the OFFICIAL, irreversible number for an existing draft / proforma through
 * the same DRAFT->REVIEW->APPROVED->finalize_sales_document chain the web UI uses (issueSalesDocumentCore).
 * The preview is read back from the DB — every figure shown is the database's own generated total, never
 * something the model computed. APPROVE tier required (canApproveInvoice), re-checked at execute time.
 */
export const issueSalesDocument: ActionDefinition<z.infer<typeof issueSalesDocumentInput>> = {
  name: "ISSUE_SALES_DOCUMENT",
  description:
    "پیشنهاد «صدور رسمی» یک پیش‌نویس فاکتور/پیش‌فاکتور که قبلاً ساخته شده (گرفتن شمارهٔ رسمی؛ برگشت‌ناپذیر است — فقط پیش‌نمایش برای تأیید کاربر). sales_document_id را فقط از نتیجهٔ ساخت پیش‌نویس یا SEARCH_INVOICES بگیر — هرگز حدس نزن. فقط وقتی کاربر صریحاً خواست سند صادر/شماره‌دار شود فراخوانی کن.",
  riskLevel: "HIGH",
  requiresConfirmation: true,
  requiredAccess: canApproveInvoice,
  inputSchema: issueSalesDocumentInput,
  handler: async (input, ctx) => {
    const { data: doc } = await ctx.supabase
      .from("sales_documents")
      .select("id, type, status, sequence_number, created_by, currency_code, total_amount, payment_terms, customer_legal_name_snapshot")
      .eq("id", input.sales_document_id)
      .maybeSingle();
    if (!doc) throw new Error("سندی با این شناسه پیدا نشد.");
    if (doc.sequence_number != null || !["DRAFT", "REVIEW", "APPROVED"].includes(doc.status)) {
      throw new Error("این سند قابل صدور رسمی نیست — قبلاً شماره گرفته یا وضعیت آن اجازه نمی‌دهد.");
    }
    if (doc.created_by !== ctx.userId && ctx.profile.role !== "ADMIN") {
      throw new Error("فقط سازندهٔ پیش‌نویس یا مدیر سامانه می‌تواند این سند را صادر کند.");
    }

    const { data: items } = await ctx.supabase
      .from("sales_document_items")
      .select("line_no, description, quantity, unit, unit_price")
      .eq("sales_document_id", doc.id)
      .order("line_no");
    const currency = (doc.currency_code ?? "IRR") as (typeof CURRENCY)[number];
    const lines = (items ?? []).map(
      (it) => `- ${it.description}: ${toFaDigits(Number(it.quantity))} ${it.unit ?? ""} × ${toFaDigits(Number(it.unit_price).toLocaleString("en-US"))}`,
    );
    const previewText = [
      `صدور رسمی ${doc.type === "INVOICE" ? "فاکتور" : "پیش‌فاکتور"} برای ${doc.customer_legal_name_snapshot ?? "-"} — شمارهٔ رسمی صادر می‌شود و این کار برگشت‌ناپذیر است:`,
      ...lines,
      `جمع کل (محاسبهٔ پایگاه‌داده): ${toFaDigits(Number(doc.total_amount ?? 0).toLocaleString("en-US"))} ${CURRENCY_LABEL[currency] ?? currency}`,
      doc.payment_terms ? `شرایط پرداخت: ${doc.payment_terms}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload: { sales_document_id: doc.id }, previewText };
  },
};

export const invoiceActions: ActionDefinition<any>[] = [createInvoiceDraft, issueSalesDocument];

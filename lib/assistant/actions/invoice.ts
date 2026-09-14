import "server-only";
import { z } from "zod";
import { CURRENCY, CURRENCY_LABEL } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import type { InvoiceDraftInput } from "@/app/actions/invoices";
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
 * HIGH-risk (spec §71) — mirrors CREATE_LETTER_DRAFT's shape: one
 * confirmation click drafts the sales_document + items, transitions it
 * through the same statuses the web UI's own buttons use, and calls the
 * existing finalize_sales_document RPC — via createAndIssueInvoiceCore
 * (app/actions/invoices.ts). No arithmetic happens here or in that
 * core; totals come only from the DB (spec §18). company_id is
 * required — never guessed (spec §17) — resolve it with SEARCH_COMPANY
 * first.
 */
export const createInvoiceDraft: ActionDefinition<z.infer<typeof createInvoiceDraftInput>> = {
  name: "CREATE_INVOICE_DRAFT",
  description:
    "پیشنهاد صدور رسمی یک فاکتور یا پیش‌فاکتور (نه ثبت قطعی — فقط پیش‌نمایش برای تأیید کاربر). company_id را فقط اگر قبلاً با SEARCH_COMPANY پیدا کرده‌اید بفرستید — هرگز حدس نزنید. اگر مشتری، تعداد، قیمت واحد یا واحد پول مشخص نیست، از کاربر بپرسید، پیشنهاد ندهید. مبلغ کل را خودت محاسبه نکن — فقط ردیف‌های خام (تعداد، قیمت واحد، تخفیف، مالیات) را بفرست. پس از تأیید کاربر، سند بلافاصله شمارهٔ رسمی می‌گیرد.",
  riskLevel: "HIGH",
  requiresConfirmation: true,
  requiredAccess: (p) => p.role === "ADMIN" || p.invoice_role != null,
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
      `${input.type === "INVOICE" ? "فاکتور" : "پیش‌فاکتور"} جدید — پس از تأیید بلافاصله شمارهٔ رسمی می‌گیرد:`,
      ...itemLines,
      `جمع کل: ${toFaDigits(totals.total.toLocaleString("en-US"))} ${CURRENCY_LABEL[currency]}`,
      input.payment_terms ? `شرایط پرداخت: ${input.payment_terms}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { payload: payload as unknown as Record<string, unknown>, previewText };
  },
};

export const invoiceActions: ActionDefinition<any>[] = [createInvoiceDraft];

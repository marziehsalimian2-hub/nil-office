import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";
import type { CurrencyAmount } from "./types";

export type InvoiceSummary = {
  issuedCount: number;
  partiallySettledCount: number;
  settledCount: number;
  overdueCount: number;
  outstandingByCurrency: CurrencyAmount[];
};

/**
 * Receivables/Invoice Executive Summary — invoice-level truth (spec §14:
 * "use existing Invoice settlement truth, don't introduce a separate
 * receivables ledger"), NOT the GL's AR control account. Posting an
 * accounting draft per invoice is an optional manual step (Invoice
 * Phase 3), so a GL-only figure would understate real outstanding
 * amounts whenever that step was skipped — this queries sales_documents
 * + receipts directly instead, the same arithmetic
 * tg_receipt_sales_document_settlement (0064) already uses to decide
 * PARTIALLY_SETTLED/SETTLED. Grouped by currency_code — genuinely
 * multi-currency at the invoice level, unlike the single-currency GL.
 */
export async function getInvoiceSummary(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "invoice_role">,
): Promise<InvoiceSummary | null> {
  if (profile.role !== "ADMIN" && profile.invoice_role == null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: outstandingDocs }, { count: settledCount }, { data: receipts }] = await Promise.all([
    supabase.from("sales_documents").select("id, currency_code, total_amount, due_date, status").eq("type", "INVOICE").in("status", ["ISSUED", "PARTIALLY_SETTLED"]),
    supabase.from("sales_documents").select("*", { count: "exact", head: true }).eq("type", "INVOICE").eq("status", "SETTLED"),
    supabase.from("receipts").select("sales_document_id, amount").eq("status", "POSTED").not("sales_document_id", "is", null),
  ]);

  const docs = (outstandingDocs ?? []) as { id: string; currency_code: string; total_amount: number; due_date: string | null; status: string }[];
  const receivedByDoc = new Map<string, number>();
  for (const r of (receipts ?? []) as { sales_document_id: string; amount: number }[]) {
    receivedByDoc.set(r.sales_document_id, (receivedByDoc.get(r.sales_document_id) ?? 0) + Number(r.amount));
  }

  const outstandingByCurrencyMap = new Map<string, number>();
  let overdueCount = 0;
  let issuedCount = 0;
  let partiallySettledCount = 0;
  for (const d of docs) {
    const outstanding = Number(d.total_amount) - (receivedByDoc.get(d.id) ?? 0);
    outstandingByCurrencyMap.set(d.currency_code, (outstandingByCurrencyMap.get(d.currency_code) ?? 0) + outstanding);
    if (d.status === "ISSUED") issuedCount++;
    if (d.status === "PARTIALLY_SETTLED") partiallySettledCount++;
    if (d.due_date && d.due_date < today) overdueCount++;
  }

  return {
    issuedCount,
    partiallySettledCount,
    settledCount: settledCount ?? 0,
    overdueCount,
    outstandingByCurrency: Array.from(outstandingByCurrencyMap, ([currency_code, amount]) => ({ currency_code, amount })),
  };
}

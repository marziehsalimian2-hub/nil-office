import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { CURRENCY_LABEL, ALLOCATION_TARGET_TYPE_LABEL, type Currency } from "@/lib/enums";
import { renderReceiptPaymentPdf, type AllocationLine } from "@/lib/pdf/renderReceiptPaymentPdf";
import type { CashAllocation } from "@/lib/types/database";

const EXT_TO_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
function extOf(p: string): string {
  return p.slice(p.lastIndexOf(".") + 1).toLowerCase();
}
async function pathToDataUri(supabase: SupabaseClient, storagePath: string | null | undefined): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = EXT_TO_MIME[extOf(storagePath)] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const KIND_TITLE: Record<"RECEIPT" | "PAYMENT", string> = {
  RECEIPT: "رسید دریافت وجه",
  PAYMENT: "رسید پرداخت وجه",
};

/**
 * Renders an official receipt/payment advice PDF. Only meaningful once
 * POSTED — a DRAFT cash document has no display_number/journal entry yet,
 * so generating a PDF for it would hand out an "official" document for
 * money that was never actually confirmed as received/paid. Mirrors the
 * verify->post gate Phase 1 already enforces at the DB layer.
 */
export async function buildReceiptPaymentPdf(
  supabase: SupabaseClient,
  kind: "RECEIPT" | "PAYMENT",
  id: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const table = kind === "RECEIPT" ? "receipts" : "payments";
  const dateCol = kind === "RECEIPT" ? "receipt_date" : "payment_date";
  const partyCol = kind === "RECEIPT" ? "payer" : "payee";

  const { data: doc, error } = await supabase.from(table).select("*").eq("id", id).single();
  if (error || !doc) throw new Error(kind === "RECEIPT" ? "رسید دریافت یافت نشد." : "رسید پرداخت یافت نشد.");
  if (doc.status !== "POSTED") {
    throw new Error(
      kind === "RECEIPT"
        ? "فقط رسیدهای دریافتِ ثبت‌نهایی‌شده (POSTED) شماره رسمی دارند؛ ابتدا سند را تأیید و ثبت نهایی کنید."
        : "فقط رسیدهای پرداختِ ثبت‌نهایی‌شده (POSTED) شماره رسمی دارند؛ ابتدا سند را تأیید و ثبت نهایی کنید.",
    );
  }

  const [{ data: settings }, companyRes, bankRes, signatoryRes, allocRes] = await Promise.all([
    supabase.from("app_settings").select("letterhead_path, stamp_path").eq("id", 1).single(),
    doc.company_id ? supabase.from("companies").select("legal_name").eq("id", doc.company_id).single() : Promise.resolve({ data: null }),
    doc.bank_account_id
      ? supabase.from("bank_accounts").select("account_title, bank_name, account_number, iban").eq("id", doc.bank_account_id).single()
      : Promise.resolve({ data: null }),
    doc.verified_by ?? doc.created_by
      ? supabase.from("profiles").select("full_name, title, signature_path").eq("id", doc.verified_by ?? doc.created_by).single()
      : Promise.resolve({ data: null }),
    supabase.from("cash_allocations").select("*").eq("source_kind", kind).eq("source_id", id),
  ]);

  const company = companyRes.data as { legal_name: string } | null;
  const bank = bankRes.data as { account_title: string; bank_name: string | null; account_number: string | null; iban: string | null } | null;
  const signatory = signatoryRes.data as { full_name: string | null; title: string | null; signature_path: string | null } | null;
  const allocations = (allocRes.data ?? []) as CashAllocation[];

  const salesDocIds = allocations.filter((a) => a.target_type === "SALES_DOCUMENT").map((a) => a.target_id!);
  const contractIds = allocations.filter((a) => a.target_type === "CONTRACT").map((a) => a.target_id!);

  const [salesDocsRes, contractsRes] = await Promise.all([
    salesDocIds.length ? supabase.from("sales_documents").select("id, display_number, type").in("id", salesDocIds) : Promise.resolve({ data: [] }),
    contractIds.length
      ? supabase.from("contracts").select("id, display_number, external_contract_number, title").in("id", contractIds)
      : Promise.resolve({ data: [] }),
  ]);

  const salesDocLabel = new Map(
    ((salesDocsRes.data ?? []) as { id: string; display_number: string | null; type: string }[]).map((s) => [
      s.id,
      s.display_number ? toFaDigits(s.display_number) : s.type === "INVOICE" ? "فاکتور (پیش‌نویس)" : "پیش‌فاکتور (پیش‌نویس)",
    ]),
  );
  const contractLabel = new Map(
    ((contractsRes.data ?? []) as { id: string; display_number: string | null; external_contract_number: string | null; title: string }[]).map(
      (c) => [c.id, `${c.display_number ? toFaDigits(c.display_number) : c.external_contract_number ? toFaDigits(c.external_contract_number) : "پیش‌نویس"} — ${c.title}`],
    ),
  );

  const allocationLines: AllocationLine[] = allocations.map((a) => ({
    targetLabel:
      a.target_type === "SALES_DOCUMENT"
        ? (salesDocLabel.get(a.target_id!) ?? "—")
        : a.target_type === "CONTRACT"
          ? (contractLabel.get(a.target_id!) ?? "—")
          : "پیش‌پرداخت (بدون سند مشخص)",
    targetTypeLabel: ALLOCATION_TARGET_TYPE_LABEL[a.target_type],
    amountLabel: formatMoney(a.amount),
    description: a.description,
  }));

  const currencyLabel = CURRENCY_LABEL[doc.currency_code as Currency] ?? doc.currency_code;

  const [letterheadDataUri, stampDataUri, signatureDataUri] = await Promise.all([
    pathToDataUri(supabase, settings?.letterhead_path),
    pathToDataUri(supabase, settings?.stamp_path),
    pathToDataUri(supabase, signatory?.signature_path),
  ]);

  const buffer = await renderReceiptPaymentPdf({
    kind,
    title: KIND_TITLE[kind],
    displayNumber: toFaDigits(doc.display_number!),
    dateLabel: formatJalali(doc[dateCol]),
    partyLabel: kind === "RECEIPT" ? "دریافت از" : "پرداخت به",
    partyName: doc[partyCol] ?? company?.legal_name ?? "—",
    amountLabel: formatMoney(doc.amount),
    currencyLabel,
    methodLabel: doc.method,
    referenceLabel: doc.reference ? toFaDigits(doc.reference) : null,
    description: doc.description,
    bankLabel: bank ? `${bank.bank_name ?? ""} ${bank.account_title}`.trim() : null,
    bankAccountNumberLabel: bank?.account_number ? toFaDigits(bank.account_number) : null,
    allocations: allocationLines,
    signatoryName: signatory?.full_name ?? null,
    signatoryTitle: signatory?.title ?? null,
    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  });

  const fileName = `${KIND_TITLE[kind]}-${company?.legal_name ?? doc[partyCol] ?? ""}-${doc.display_number}.pdf`;
  return { buffer, fileName };
}

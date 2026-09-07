import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali, formatGregorian, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { SALES_DOCUMENT_TYPE_LABEL, SALES_DOCUMENT_ITEM_TYPE_LABEL, CURRENCY_LABEL, type SalesDocumentType, type SalesDocumentItemType, type Currency } from "@/lib/enums";
import { renderInvoicePdf } from "@/lib/pdf/renderInvoicePdf";

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const DOC_TYPE_LABEL_EN: Record<SalesDocumentType, string> = {
  PROFORMA: "Proforma Invoice",
  INVOICE: "Invoice",
};
const ITEM_TYPE_LABEL_EN: Record<SalesDocumentItemType, string> = {
  GOODS: "Goods",
  SERVICE: "Service",
};

function extOf(p: string): string {
  return p.slice(p.lastIndexOf(".") + 1).toLowerCase();
}

async function pathToDataUri(
  supabase: SupabaseClient,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = EXT_TO_MIME[extOf(storagePath)] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Renders a proforma/invoice PDF. Customer info is read only from the
 * *_snapshot columns (never a live companies join) — the mechanism that
 * structurally guarantees an already-issued document's PDF cannot change
 * if the company profile is edited later.
 *
 * `language` (FA/EN) branches digit script, date calendar (Jalali vs.
 * Gregorian), and currency/item-type labels — see renderInvoicePdf.ts
 * for the corresponding template-side branch.
 */
export async function buildInvoicePdf(supabase: SupabaseClient, id: string): Promise<Buffer> {
  const { data: doc, error } = await supabase
    .from("sales_documents")
    .select(
      `id, type, display_number, contract_id, currency_code, subtotal, discount_amount, tax_amount, total_amount,
       payment_terms, notes, issued_by, created_by, created_at, issued_at, signatory_id, language,
       customer_legal_name_snapshot, customer_english_name_snapshot, customer_registration_number_snapshot,
       customer_national_id_snapshot, customer_economic_code_snapshot, customer_address_snapshot,
       customer_contact_person_snapshot, customer_phone_snapshot,
       bank_name_snapshot, bank_account_title_snapshot, bank_account_number_snapshot, bank_account_iban_snapshot`,
    )
    .eq("id", id)
    .single();
  if (error || !doc) throw new Error("سند یافت نشد.");

  const isEn = doc.language === "EN";

  const [{ data: items }, { data: settings }, contractRes, signatoryRes] = await Promise.all([
    supabase
      .from("sales_document_items")
      .select("description, item_type, quantity, unit, unit_price, discount_amount, tax_amount, line_total")
      .eq("sales_document_id", id)
      .order("line_no"),
    supabase.from("app_settings").select("letterhead_path, stamp_path").eq("id", 1).single(),
    doc.contract_id
      ? supabase.from("contracts").select("display_number, external_contract_number, title").eq("id", doc.contract_id).single()
      : Promise.resolve({ data: null }),
    (doc.signatory_id ?? doc.issued_by ?? doc.created_by)
      ? supabase
          .from("profiles")
          .select("full_name, title, signature_path")
          .eq("id", doc.signatory_id ?? doc.issued_by ?? doc.created_by)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const contract = contractRes.data;
  const signatory = signatoryRes.data;

  const [letterheadDataUri, stampDataUri, signatureDataUri] = await Promise.all([
    pathToDataUri(supabase, settings?.letterhead_path),
    pathToDataUri(supabase, settings?.stamp_path),
    pathToDataUri(supabase, signatory?.signature_path),
  ]);

  const currencyLabel = isEn ? doc.currency_code : (CURRENCY_LABEL[doc.currency_code as Currency] ?? doc.currency_code);
  const money = (v: number) => formatMoney(v, undefined, isEn ? "en" : "fa");

  return renderInvoicePdf({
    language: isEn ? "EN" : "FA",
    displayNumber: doc.display_number ? (isEn ? doc.display_number : toFaDigits(doc.display_number)) : null,
    dateLabel: isEn ? formatGregorian(doc.issued_at ?? doc.created_at) : formatJalali(doc.issued_at ?? doc.created_at),
    docTypeLabel: isEn ? DOC_TYPE_LABEL_EN[doc.type as SalesDocumentType] : SALES_DOCUMENT_TYPE_LABEL[doc.type as SalesDocumentType],
    title: doc.display_number ? (isEn ? doc.display_number : toFaDigits(doc.display_number)) : (isEn ? "Draft" : "پیش‌نویس"),

    customerLegalName: doc.customer_legal_name_snapshot,
    customerEnglishName: doc.customer_english_name_snapshot,
    // Free-typed identifiers/address — convert digits to Persian for FA
    // display only; phone stays as-typed either way (dialing convention).
    customerRegistrationNumber: doc.customer_registration_number_snapshot ? (isEn ? doc.customer_registration_number_snapshot : toFaDigits(doc.customer_registration_number_snapshot)) : null,
    customerNationalId: doc.customer_national_id_snapshot ? (isEn ? doc.customer_national_id_snapshot : toFaDigits(doc.customer_national_id_snapshot)) : null,
    customerEconomicCode: doc.customer_economic_code_snapshot ? (isEn ? doc.customer_economic_code_snapshot : toFaDigits(doc.customer_economic_code_snapshot)) : null,
    customerAddress: doc.customer_address_snapshot ? (isEn ? doc.customer_address_snapshot : toFaDigits(doc.customer_address_snapshot)) : null,
    customerContactPerson: doc.customer_contact_person_snapshot,
    customerPhone: doc.customer_phone_snapshot,

    contractLabel: contract ? `${contract.display_number ?? contract.external_contract_number ?? ""} — ${contract.title}` : null,

    items: (items ?? []).map((it) => ({
      description: it.description,
      itemTypeLabel: isEn ? ITEM_TYPE_LABEL_EN[it.item_type as SalesDocumentItemType] : SALES_DOCUMENT_ITEM_TYPE_LABEL[it.item_type as SalesDocumentItemType],
      quantityLabel: isEn ? String(it.quantity) : toFaDigits(String(it.quantity)),
      unit: it.unit,
      unitPriceLabel: money(it.unit_price),
      discountLabel: money(it.discount_amount),
      taxLabel: money(it.tax_amount),
      lineTotalLabel: money(it.line_total),
    })),

    currencyLabel,
    subtotalLabel: money(doc.subtotal),
    discountLabel: money(doc.discount_amount),
    taxLabel: money(doc.tax_amount),
    totalLabel: `${money(doc.total_amount)} ${currencyLabel}`,

    paymentTerms: doc.payment_terms,
    notes: doc.notes,

    bankName: doc.bank_name_snapshot,
    bankAccountTitle: doc.bank_account_title_snapshot,
    bankAccountNumber: doc.bank_account_number_snapshot ? (isEn ? doc.bank_account_number_snapshot : toFaDigits(doc.bank_account_number_snapshot)) : null,
    bankIban: doc.bank_account_iban_snapshot,

    nilSignatoryName: signatory?.full_name ?? null,
    nilSignatoryTitle: signatory?.title ?? null,

    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  });
}

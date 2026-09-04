import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { SALES_DOCUMENT_TYPE_LABEL, SALES_DOCUMENT_ITEM_TYPE_LABEL, type SalesDocumentType, type SalesDocumentItemType } from "@/lib/enums";
import { renderInvoicePdf } from "@/lib/pdf/renderInvoicePdf";

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
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
 */
export async function buildInvoicePdf(supabase: SupabaseClient, id: string): Promise<Buffer> {
  const { data: doc, error } = await supabase
    .from("sales_documents")
    .select(
      `id, type, display_number, contract_id, currency_code, subtotal, discount_amount, tax_amount, total_amount,
       payment_terms, notes, issued_by, created_by, created_at, issued_at, signatory_id,
       customer_legal_name_snapshot, customer_english_name_snapshot, customer_registration_number_snapshot,
       customer_national_id_snapshot, customer_economic_code_snapshot, customer_address_snapshot,
       customer_contact_person_snapshot, customer_phone_snapshot`,
    )
    .eq("id", id)
    .single();
  if (error || !doc) throw new Error("سند یافت نشد.");

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

  return renderInvoicePdf({
    displayNumber: doc.display_number,
    dateLabel: formatJalali(doc.issued_at ?? doc.created_at),
    docTypeLabel: SALES_DOCUMENT_TYPE_LABEL[doc.type as SalesDocumentType],
    title: doc.display_number ? toFaDigits(doc.display_number) : "پیش‌نویس",

    customerLegalName: doc.customer_legal_name_snapshot,
    customerEnglishName: doc.customer_english_name_snapshot,
    customerRegistrationNumber: doc.customer_registration_number_snapshot,
    customerNationalId: doc.customer_national_id_snapshot,
    customerEconomicCode: doc.customer_economic_code_snapshot,
    customerAddress: doc.customer_address_snapshot,
    customerContactPerson: doc.customer_contact_person_snapshot,
    customerPhone: doc.customer_phone_snapshot,

    contractLabel: contract ? `${contract.display_number ?? contract.external_contract_number ?? ""} — ${contract.title}` : null,

    items: (items ?? []).map((it) => ({
      description: it.description,
      itemTypeLabel: SALES_DOCUMENT_ITEM_TYPE_LABEL[it.item_type as SalesDocumentItemType],
      quantityLabel: toFaDigits(String(it.quantity)),
      unit: it.unit,
      unitPriceLabel: formatMoney(it.unit_price),
      discountLabel: formatMoney(it.discount_amount),
      taxLabel: formatMoney(it.tax_amount),
      lineTotalLabel: formatMoney(it.line_total),
    })),

    currencyLabel: doc.currency_code,
    subtotalLabel: formatMoney(doc.subtotal),
    discountLabel: formatMoney(doc.discount_amount),
    taxLabel: formatMoney(doc.tax_amount),
    totalLabel: `${formatMoney(doc.total_amount)} ${doc.currency_code}`,

    paymentTerms: doc.payment_terms,
    notes: doc.notes,

    nilSignatoryName: signatory?.full_name ?? null,
    nilSignatoryTitle: signatory?.title ?? null,

    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  });
}

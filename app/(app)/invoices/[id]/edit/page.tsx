import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "../../new/InvoiceForm";
import type { SalesDocument, SalesDocumentItem } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase.from("sales_documents").select("*").eq("id", id).single();
  if (!doc) notFound();
  const d = doc as SalesDocument;
  if (!["DRAFT", "REVIEW"].includes(d.status)) redirect(`/invoices/${id}`);

  const [{ data: items }, { data: companies }, { data: contracts }, { data: cases }] = await Promise.all([
    supabase.from("sales_document_items").select("*").eq("sales_document_id", id).order("line_no"),
    supabase.from("companies").select("id, legal_name, english_name, contact_person, email, phone, address").order("legal_name"),
    supabase.from("contracts").select("id, title, display_number, external_contract_number").order("created_at", { ascending: false }),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
  ]);

  const itemLines = ((items ?? []) as SalesDocumentItem[]).map((it) => ({
    item_type: it.item_type,
    description: it.description,
    unit: it.unit ?? "",
    quantity: String(it.quantity),
    unit_price: String(it.unit_price),
    discount_amount: String(it.discount_amount),
    tax_amount: String(it.tax_amount),
  }));

  return (
    <div>
      <PageHeader title="ویرایش سند" subtitle={d.display_number ?? "پیش‌نویس"} />
      <InvoiceForm
        docId={id}
        companies={companies ?? []}
        contracts={(contracts ?? []).map((c) => ({ id: c.id, label: `${c.display_number ?? c.external_contract_number ?? ""} — ${c.title}` }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        initial={{
          type: d.type,
          company_id: d.company_id,
          contract_id: d.contract_id,
          case_id: d.case_id,
          issue_date: d.issue_date,
          due_date: d.due_date,
          validity_date: d.validity_date,
          currency_code: d.currency_code,
          payment_terms: d.payment_terms,
          notes: d.notes,
          customer_legal_name_snapshot: d.customer_legal_name_snapshot,
          customer_english_name_snapshot: d.customer_english_name_snapshot,
          customer_registration_number_snapshot: d.customer_registration_number_snapshot,
          customer_national_id_snapshot: d.customer_national_id_snapshot,
          customer_economic_code_snapshot: d.customer_economic_code_snapshot,
          customer_address_snapshot: d.customer_address_snapshot,
          customer_postal_code_snapshot: d.customer_postal_code_snapshot,
          customer_contact_person_snapshot: d.customer_contact_person_snapshot,
          customer_email_snapshot: d.customer_email_snapshot,
          customer_phone_snapshot: d.customer_phone_snapshot,
          items: itemLines,
        }}
      />
    </div>
  );
}

import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { InvoiceForm } from "./InvoiceForm";
import type { SalesDocumentType } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, { data: contracts }, { data: cases }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, english_name, contact_person, email, phone, address").order("legal_name"),
    supabase.from("contracts").select("id, title, display_number, external_contract_number").order("created_at", { ascending: false }),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <PageHeader title="سند فروش جدید" subtitle="ثبت پیش‌نویس پیش‌فاکتور یا فاکتور" />
      <InvoiceForm
        defaultType={(type === "INVOICE" ? "INVOICE" : "PROFORMA") as SalesDocumentType}
        companies={companies ?? []}
        contracts={(contracts ?? []).map((c) => ({ id: c.id, label: `${c.display_number ?? c.external_contract_number ?? ""} — ${c.title}` }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
      />
    </div>
  );
}

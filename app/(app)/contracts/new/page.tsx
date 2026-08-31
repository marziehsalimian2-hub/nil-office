import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ContractForm } from "./ContractForm";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  const supabase = await createClient();
  const [{ data: types }, { data: companies }, { data: cases }, { data: profiles }] = await Promise.all([
    supabase.from("contract_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  return (
    <div>
      <PageHeader title="قرارداد جدید" subtitle="ثبت پیش‌نویس قرارداد" />
      <ContractForm
        types={(types ?? []).map((t) => ({ id: t.id, label: t.name }))}
        companies={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
    </div>
  );
}

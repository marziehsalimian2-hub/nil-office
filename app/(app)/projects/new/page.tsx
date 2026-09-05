import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ProjectForm } from "./ProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunity_id?: string; contract_id?: string }>;
}) {
  const { opportunity_id, contract_id } = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, { data: cases }, { data: opportunities }, { data: contracts }, { data: profiles }] = await Promise.all([
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("crm_opportunities").select("id, opportunity_number, title").order("created_at", { ascending: false }),
    supabase.from("contracts").select("id, title, display_number, external_contract_number").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  return (
    <div>
      <PageHeader title="پروژهٔ جدید" subtitle="ثبت پیش‌نویس پروژه" />
      <ProjectForm
        companies={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        opportunities={(opportunities ?? []).map((o) => ({ id: o.id, label: `${o.opportunity_number} — ${o.title}` }))}
        contracts={(contracts ?? []).map((c) => ({ id: c.id, label: `${c.display_number ?? c.external_contract_number ?? ""} — ${c.title}` }))}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        defaultOpportunityId={opportunity_id}
        defaultContractId={contract_id}
      />
    </div>
  );
}

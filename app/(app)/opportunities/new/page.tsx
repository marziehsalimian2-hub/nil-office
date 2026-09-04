import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { OpportunityForm } from "./OpportunityForm";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<{ company_id?: string }>;
}) {
  const { company_id } = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, { data: contacts }, { data: cases }, { data: pipelines }, { data: stages }, { data: profiles }] =
    await Promise.all([
      supabase.from("companies").select("id, legal_name").order("legal_name"),
      supabase.from("company_contacts").select("id, company_id, first_name, last_name").eq("is_active", true),
      supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
      supabase.from("crm_pipelines").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("crm_pipeline_stages").select("id, pipeline_id, name, sort_order").order("sort_order"),
      supabase.from("profiles").select("id, full_name").eq("is_active", true),
    ]);

  const pipelineList = (pipelines ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: (stages ?? []).filter((s) => s.pipeline_id === p.id).map((s) => ({ id: s.id, name: s.name })),
  }));

  return (
    <div>
      <PageHeader title="فرصت تجاری جدید" subtitle="ثبت فرصت در پایپ‌لاین فروش" />
      <OpportunityForm
        companies={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
        contacts={(contacts ?? []).map((c) => ({ id: c.id, company_id: c.company_id, label: `${c.first_name} ${c.last_name ?? ""}`.trim() }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        pipelines={pipelineList}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        defaultCompanyId={company_id}
      />
    </div>
  );
}

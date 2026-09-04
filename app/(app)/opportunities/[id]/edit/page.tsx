import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { OpportunityForm } from "../../new/OpportunityForm";
import type { CrmOpportunity } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: opp } = await supabase.from("crm_opportunities").select("*").eq("id", id).single();
  if (!opp) notFound();
  const o = opp as CrmOpportunity;
  if (o.won_at || o.lost_at) redirect(`/opportunities/${id}`);

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
      <PageHeader title="ویرایش فرصت تجاری" subtitle={o.title} />
      <OpportunityForm
        docId={id}
        companies={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
        contacts={(contacts ?? []).map((c) => ({ id: c.id, company_id: c.company_id, label: `${c.first_name} ${c.last_name ?? ""}`.trim() }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        pipelines={pipelineList}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        initial={{
          title: o.title,
          company_id: o.company_id,
          primary_contact_id: o.primary_contact_id,
          case_id: o.case_id,
          opportunity_type: o.opportunity_type,
          pipeline_id: o.pipeline_id,
          stage_id: o.stage_id,
          owner_user_id: o.owner_user_id,
          currency_code: o.currency_code,
          estimated_value: o.estimated_value,
          probability: o.probability,
          expected_close_date: o.expected_close_date,
          source: o.source,
          priority: o.priority,
          description: o.description,
          internal_notes: o.internal_notes,
          next_action: o.next_action,
          next_action_date: o.next_action_date,
        }}
      />
    </div>
  );
}

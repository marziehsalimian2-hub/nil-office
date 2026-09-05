import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ProjectForm } from "../../new/ProjectForm";
import type { Project } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: proj } = await supabase.from("projects").select("*").eq("id", id).single();
  if (!proj) notFound();
  const p = proj as Project;
  if (!["DRAFT", "PLANNED"].includes(p.status)) redirect(`/projects/${id}`);

  const [{ data: companies }, { data: cases }, { data: opportunities }, { data: contracts }, { data: profiles }] = await Promise.all([
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("crm_opportunities").select("id, opportunity_number, title").order("created_at", { ascending: false }),
    supabase.from("contracts").select("id, title, display_number, external_contract_number").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  return (
    <div>
      <PageHeader title="ویرایش پروژه" subtitle={p.display_number ?? "پیش‌نویس"} />
      <ProjectForm
        docId={id}
        companies={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={(cases ?? []).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        opportunities={(opportunities ?? []).map((o) => ({ id: o.id, label: `${o.opportunity_number} — ${o.title}` }))}
        contracts={(contracts ?? []).map((c) => ({ id: c.id, label: `${c.display_number ?? c.external_contract_number ?? ""} — ${c.title}` }))}
        profiles={(profiles ?? []).map((p2) => ({ id: p2.id, label: p2.full_name ?? "—" }))}
        initial={{
          title: p.title,
          description: p.description,
          project_type: p.project_type,
          company_id: p.company_id,
          case_id: p.case_id,
          crm_opportunity_id: p.crm_opportunity_id,
          contract_id: p.contract_id,
          project_manager_id: p.project_manager_id,
          owner_user_id: p.owner_user_id,
          priority: p.priority,
          planned_start_date: p.planned_start_date,
          planned_end_date: p.planned_end_date,
          actual_start_date: p.actual_start_date,
          actual_end_date: p.actual_end_date,
          progress_percent: p.progress_percent,
          budget_amount: p.budget_amount,
          budget_currency: p.budget_currency,
        }}
      />
    </div>
  );
}

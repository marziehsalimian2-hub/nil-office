import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReportBuilderForm } from "./ReportBuilderForm";
import type { ClientServiceReportTemplate, ReportFamilyT } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function NewClientServiceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template_id?: string; family?: string }>;
}) {
  const { id: companyId } = await params;
  const { template_id, family } = await searchParams;
  const supabase = await createClient();
  const profile = await requireProfile();
  const canViewProfitability = profile.role === "ADMIN" || profile.service_ledger_role === "ADMIN";

  const [{ data: company }, { data: serviceFile }] = await Promise.all([
    supabase.from("companies").select("legal_name").eq("id", companyId).single(),
    supabase.from("client_service_files").select("id").eq("company_id", companyId).maybeSingle(),
  ]);
  if (!company || !serviceFile) notFound();

  // RLS (migration 0095) already restricts report_family='INTERNAL' rows
  // to can_view_internal_cost() holders — no extra filter needed here,
  // an unauthorized caller simply never sees them.
  const { data: templates } = await supabase
    .from("client_service_report_templates")
    .select("*")
    .eq("is_active", true)
    .or(`scope.eq.GLOBAL,company_id.eq.${companyId}`)
    .order("template_name");

  return (
    <div>
      <PageHeader title="گزارش جدید" subtitle={company.legal_name} />
      <ReportBuilderForm
        companyId={companyId}
        clientServiceFileId={serviceFile.id}
        templates={(templates ?? []) as ClientServiceReportTemplate[]}
        initialTemplateId={template_id}
        initialFamily={family === "INTERNAL" ? "INTERNAL" : ("CLIENT" as ReportFamilyT)}
        canViewProfitability={canViewProfitability}
      />
    </div>
  );
}

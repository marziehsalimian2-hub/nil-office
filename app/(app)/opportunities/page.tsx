import Link from "next/link";
import { Plus, Kanban, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { OpportunityStageBadge } from "@/components/OpportunityStageBadge";
import { FilterBar } from "./FilterBar";
import { CRM_OPPORTUNITY_TYPE_LABEL, type CrmOpportunityType } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  opportunity_number: string;
  title: string;
  opportunity_type: string;
  estimated_value: number | null;
  currency_code: string;
  won_at: string | null;
  lost_at: string | null;
  companies: { legal_name: string } | { legal_name: string }[] | null;
  crm_pipeline_stages: { name: string; is_won: boolean; is_lost: boolean } | { name: string; is_won: boolean; is_lost: boolean }[] | null;
};

type SearchParams = {
  pipeline_id?: string;
  stage_id?: string;
  owner_user_id?: string;
  opportunity_type?: string;
  priority?: string;
  status?: string;
};

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("crm_opportunities")
    .select("id, opportunity_number, title, opportunity_type, estimated_value, currency_code, won_at, lost_at, companies(legal_name), crm_pipeline_stages(name, is_won, is_lost)")
    .order("created_at", { ascending: false });

  if (sp.pipeline_id) query = query.eq("pipeline_id", sp.pipeline_id);
  if (sp.stage_id) query = query.eq("stage_id", sp.stage_id);
  if (sp.owner_user_id) query = query.eq("owner_user_id", sp.owner_user_id);
  if (sp.opportunity_type) query = query.eq("opportunity_type", sp.opportunity_type);
  if (sp.priority) query = query.eq("priority", sp.priority);
  if (sp.status === "open") query = query.is("won_at", null).is("lost_at", null);
  if (sp.status === "won") query = query.not("won_at", "is", null);
  if (sp.status === "lost") query = query.not("lost_at", "is", null);

  let staleIds: string[] | null = null;
  if (sp.status === "stale") {
    const { data: stale } = await supabase.rpc("get_stale_crm_opportunities", { p_days: 14 });
    staleIds = ((stale ?? []) as { id: string }[]).map((s) => s.id);
    query = query.in("id", staleIds.length > 0 ? staleIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data }, { data: pipelines }, { data: stages }, { data: profiles }] = await Promise.all([
    query,
    supabase.from("crm_pipelines").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("crm_pipeline_stages").select("id, pipeline_id, name").order("sort_order"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  const rows = (data ?? []) as Row[];
  const pipelineList = (pipelines ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: (stages ?? []).filter((s) => s.pipeline_id === p.id).map((s) => ({ id: s.id, label: s.name })),
  }));

  return (
    <div>
      <PageHeader
        title="فرصت‌های تجاری"
        subtitle="پایپ‌لاین فرصت‌ها و معاملات در حال پیگیری"
        action={
          <div className="flex gap-2">
            <Link href="/opportunities/dashboard" className="btn-ghost"><LayoutDashboard className="h-4 w-4" /> داشبورد</Link>
            <Link href="/opportunities/board" className="btn-ghost"><Kanban className="h-4 w-4" /> نمای کانبان</Link>
            <Link href="/opportunities/new" className="btn-seal"><Plus className="h-4 w-4" /> فرصت جدید</Link>
          </div>
        }
      />
      <FilterBar
        pipelines={pipelineList}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
      {rows.length === 0 ? (
        <EmptyState title="فرصتی با این فیلترها یافت نشد." hint="فیلترها را تغییر دهید یا فرصت جدیدی ثبت کنید."
          action={<Link href="/opportunities/new" className="btn-primary"><Plus className="h-4 w-4" /> فرصت جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">عنوان</th>
              <th className="px-4 py-3">شرکت</th><th className="px-4 py-3">نوع</th>
              <th className="px-4 py-3">مرحله</th><th className="px-4 py-3 text-left">ارزش تخمینی</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => {
                const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
                const stage = Array.isArray(o.crm_pipeline_stages) ? o.crm_pipeline_stages[0] : o.crm_pipeline_stages;
                return (
                  <tr key={o.id} className="table-row">
                    <td className="px-4 py-3 tnum font-medium text-ink"><Link href={`/opportunities/${o.id}`} className="hover:underline">{toFaDigits(o.opportunity_number)}</Link></td>
                    <td className="px-4 py-3 text-ink">{o.title}</td>
                    <td className="px-4 py-3 text-ink-muted">{company?.legal_name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{CRM_OPPORTUNITY_TYPE_LABEL[o.opportunity_type as CrmOpportunityType]}</td>
                    <td className="px-4 py-3">
                      {stage && <OpportunityStageBadge name={stage.name} isWon={stage.is_won} isLost={stage.is_lost} />}
                    </td>
                    <td className="px-4 py-3 text-left tnum text-ink">{o.estimated_value != null ? `${formatMoney(o.estimated_value)} ${o.currency_code}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { PageHeader, StatCard, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { CRM_ACTIVITY_TYPE_LABEL, type CrmActivityType } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

const STALE_DAYS = 14;

async function count(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

export default async function CrmDashboardPage() {
  const supabase = await createClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [
    openCount,
    newLeadsCount,
    wonCount,
    lostCount,
    overdueCount,
    openTradeCount,
    quotesSentCount,
    { data: staleRows },
    { data: recentActivities },
    { data: stages },
    { data: openStageCounts },
  ] = await Promise.all([
    count(supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).is("won_at", null).is("lost_at", null) as never),
    count(supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo) as never),
    count(supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).not("won_at", "is", null) as never),
    count(supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).not("lost_at", "is", null) as never),
    count(
      supabase
        .from("crm_opportunities")
        .select("*", { count: "exact", head: true })
        .is("won_at", null)
        .is("lost_at", null)
        .not("next_action_date", "is", null)
        .lt("next_action_date", today) as never,
    ),
    count(
      supabase
        .from("crm_opportunities")
        .select("*", { count: "exact", head: true })
        .is("won_at", null)
        .is("lost_at", null)
        .eq("opportunity_type", "TRADE") as never,
    ),
    count(supabase.from("crm_quotations").select("*", { count: "exact", head: true }).eq("direction", "SENT").gte("created_at", thirtyDaysAgo) as never),
    supabase.rpc("get_stale_crm_opportunities", { p_days: STALE_DAYS }),
    supabase
      .from("crm_activities")
      .select("id, subject, activity_type, activity_date, companies(legal_name), crm_opportunities(title)")
      .order("activity_date", { ascending: false })
      .limit(10),
    supabase.from("crm_pipeline_stages").select("id, pipeline_id, name, sort_order, is_won, is_lost, crm_pipelines(name)").order("sort_order"),
    supabase.from("crm_opportunities").select("stage_id").is("won_at", null).is("lost_at", null),
  ]);

  type StaleRow = { id: string; opportunity_number: string; title: string; company_name: string; owner_name: string | null; days_stale: number };
  type ActivityRow = {
    id: string; subject: string; activity_type: string; activity_date: string;
    companies: { legal_name: string } | { legal_name: string }[] | null;
    crm_opportunities: { title: string } | { title: string }[] | null;
  };
  type StageRow = { id: string; pipeline_id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean; crm_pipelines: { name: string } | { name: string }[] | null };

  const staleList = (staleRows ?? []) as StaleRow[];
  const activityList = (recentActivities ?? []) as ActivityRow[];
  const stageList = (stages ?? []) as StageRow[];

  const stageCountMap = new Map<string, number>();
  for (const row of (openStageCounts ?? []) as { stage_id: string }[]) {
    stageCountMap.set(row.stage_id, (stageCountMap.get(row.stage_id) ?? 0) + 1);
  }

  const pipelineGroups = new Map<string, { name: string; stages: { name: string; count: number }[] }>();
  for (const s of stageList) {
    if (s.is_won || s.is_lost) continue;
    const pipelineName = (Array.isArray(s.crm_pipelines) ? s.crm_pipelines[0] : s.crm_pipelines)?.name ?? "—";
    if (!pipelineGroups.has(s.pipeline_id)) pipelineGroups.set(s.pipeline_id, { name: pipelineName, stages: [] });
    pipelineGroups.get(s.pipeline_id)!.stages.push({ name: s.name, count: stageCountMap.get(s.id) ?? 0 });
  }

  return (
    <div>
      <PageHeader title="داشبورد CRM" subtitle="نمای کلی پایپ‌لاین فروش و فعالیت‌ها" />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="فرصت‌های باز" value={toFaDigits(openCount)} href="/opportunities?status=open" />
        <StatCard label="لیدهای جدید (۷ روز اخیر)" value={toFaDigits(newLeadsCount)} />
        <StatCard label="موفق" value={toFaDigits(wonCount)} tone="seal" href="/opportunities?status=won" />
        <StatCard label="ازدست‌رفته" value={toFaDigits(lostCount)} tone="danger" href="/opportunities?status=lost" />
        <StatCard label="اقدامات عقب‌افتاده" value={toFaDigits(overdueCount)} tone="warn" />
        <StatCard label="فرصت‌های تجاری باز" value={toFaDigits(openTradeCount)} href="/opportunities?opportunity_type=TRADE&status=open" />
        <StatCard label="پیشنهاد ارسالی (۳۰ روز اخیر)" value={toFaDigits(quotesSentCount)} />
        <StatCard label="بدون فعالیت" value={toFaDigits(staleList.length)} tone="warn" href="/opportunities?status=stale" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-sm font-medium text-ink">فرصت‌های بدون فعالیت (بیش از {toFaDigits(STALE_DAYS)} روز)</p>
          {staleList.length === 0 ? (
            <p className="text-sm text-ink-muted">فرصت راکدی وجود ندارد.</p>
          ) : (
            <ul className="divide-y divide-paper-line/60">
              {staleList.map((s) => (
                <li key={s.id} className="py-2.5">
                  <Link href={`/opportunities/${s.id}`} className="text-sm text-seal hover:underline">
                    {toFaDigits(s.opportunity_number)} — {s.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {s.company_name} · {s.owner_name ?? "بدون مالک"} · {toFaDigits(s.days_stale)} روز بدون فعالیت
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <p className="mb-3 text-sm font-medium text-ink">فعالیت‌های اخیر</p>
          {activityList.length === 0 ? (
            <p className="text-sm text-ink-muted">فعالیتی ثبت نشده است.</p>
          ) : (
            <ul className="divide-y divide-paper-line/60">
              {activityList.map((a) => {
                const company = Array.isArray(a.companies) ? a.companies[0] : a.companies;
                const opp = Array.isArray(a.crm_opportunities) ? a.crm_opportunities[0] : a.crm_opportunities;
                return (
                  <li key={a.id} className="py-2.5">
                    <p className="text-sm text-ink">
                      <span className="text-ink-muted">{CRM_ACTIVITY_TYPE_LABEL[a.activity_type as CrmActivityType]}</span> — {a.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {company?.legal_name ?? "—"}{opp ? ` · ${opp.title}` : ""} · {formatJalali(a.activity_date)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {Array.from(pipelineGroups.values()).map((pg) => (
          <Card key={pg.name}>
            <p className="mb-3 text-sm font-medium text-ink">{pg.name} — فرصت‌های باز به تفکیک مرحله</p>
            <ul className="divide-y divide-paper-line/60">
              {pg.stages.map((s) => (
                <li key={s.name} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink-muted">{s.name}</span>
                  <span className="tnum font-medium text-ink">{toFaDigits(s.count)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

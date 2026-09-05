import Link from "next/link";
import { PageHeader, StatCard, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { computeProjectHealth } from "@/lib/project-health";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { Project, ProjectProgressSummary } from "@/lib/types/database";

export const dynamic = "force-dynamic";

async function count(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

export default async function ProjectDashboardPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const [
    activeCount,
    overdueTaskCount,
    blockedTaskCount,
    pendingDeliverableCount,
    { data: openProjects },
    { data: summaryRows },
    { data: upcomingMilestones },
    { data: recentlyCompleted },
  ] = await Promise.all([
    count(supabase.from("projects").select("*", { count: "exact", head: true }).eq("status", "ACTIVE") as never),
    count(supabase.from("tasks").select("*", { count: "exact", head: true }).lt("due_date", today).not("status", "in", "(DONE,CANCELLED)") as never),
    count(supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "BLOCKED") as never),
    count(supabase.from("project_deliverables").select("*", { count: "exact", head: true }).in("status", ["PLANNED", "IN_PROGRESS", "READY_FOR_REVIEW"]) as never),
    supabase.from("projects").select("*").not("status", "in", "(COMPLETED,CANCELLED,ARCHIVED)"),
    supabase.rpc("get_project_progress_summary"),
    supabase
      .from("project_milestones")
      .select("id, title, due_date, projects(id, title, display_number)")
      .lte("due_date", twoWeeksOut)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .order("due_date")
      .limit(10),
    supabase.from("projects").select("id, title, display_number, actual_end_date").eq("status", "COMPLETED").order("actual_end_date", { ascending: false }).limit(5),
  ]);

  const summaryMap = new Map(((summaryRows ?? []) as ProjectProgressSummary[]).map((s) => [s.project_id, s]));
  const openProjectRows = (openProjects ?? []) as Project[];

  let atRiskCount = 0;
  let delayedCount = 0;
  let endingSoonCount = 0;
  for (const p of openProjectRows) {
    const summary = summaryMap.get(p.id);
    if (summary) {
      const health = computeProjectHealth(p, summary);
      if (health === "AT_RISK") atRiskCount++;
      if (health === "DELAYED") delayedCount++;
    }
    if (p.planned_end_date && p.planned_end_date >= today && p.planned_end_date <= twoWeeksOut) endingSoonCount++;
  }

  type MilestoneRow = { id: string; title: string; due_date: string; projects: { id: string; title: string; display_number: string | null } | { id: string; title: string; display_number: string | null }[] | null };
  const milestoneList = (upcomingMilestones ?? []) as MilestoneRow[];

  return (
    <div>
      <PageHeader title="داشبورد پروژه‌ها" subtitle="نمای کلی اجرای پروژه‌ها" />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="پروژه‌های فعال" value={toFaDigits(activeCount)} href="/projects?tab=active" />
        <StatCard label="در معرض خطر" value={toFaDigits(atRiskCount)} tone="warn" href="/projects?tab=at_risk" />
        <StatCard label="عقب‌افتاده" value={toFaDigits(delayedCount)} tone="danger" href="/projects?tab=overdue" />
        <StatCard label="نزدیک به پایان (۱۴ روز)" value={toFaDigits(endingSoonCount)} />
        <StatCard label="کارهای عقب‌افتاده" value={toFaDigits(overdueTaskCount)} tone="danger" href="/tasks?due=overdue" />
        <StatCard label="کارهای مسدود" value={toFaDigits(blockedTaskCount)} tone="warn" href="/tasks?status=BLOCKED" />
        <StatCard label="تحویل‌دادنی‌های در جریان" value={toFaDigits(pendingDeliverableCount)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-sm font-medium text-ink">مایلستون‌های پیش‌رو (۱۴ روز آینده)</p>
          {milestoneList.length === 0 ? (
            <p className="text-sm text-ink-muted">مایلستونی در این بازه یافت نشد.</p>
          ) : (
            <ul className="divide-y divide-paper-line/60">
              {milestoneList.map((m) => {
                const project = Array.isArray(m.projects) ? m.projects[0] : m.projects;
                return (
                  <li key={m.id} className="py-2.5">
                    <p className="text-sm text-ink">{m.title}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {project && <Link href={`/projects/${project.id}`} className="text-seal hover:underline">{project.display_number ?? project.title}</Link>}
                      {" · "}{formatJalali(m.due_date)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <p className="mb-3 text-sm font-medium text-ink">پروژه‌های اخیراً تکمیل‌شده</p>
          {(recentlyCompleted ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">پروژه‌ای اخیراً تکمیل نشده است.</p>
          ) : (
            <ul className="divide-y divide-paper-line/60">
              {(recentlyCompleted ?? []).map((p) => (
                <li key={p.id} className="py-2.5">
                  <Link href={`/projects/${p.id}`} className="text-sm text-seal hover:underline">{p.display_number ?? p.title}</Link>
                  {p.actual_end_date && <p className="mt-0.5 text-xs text-ink-muted">{formatJalali(p.actual_end_date)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

import Link from "next/link";
import { Plus, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import { computeProjectHealth } from "@/lib/project-health";
import { PROJECT_TYPE_LABEL, type ProjectType } from "@/lib/enums";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import type { Project, Company, ProjectProgressSummary } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "", label: "همه" },
  { key: "active", label: "فعال" },
  { key: "mine", label: "پروژه‌های من" },
  { key: "at_risk", label: "در معرض خطر" },
  { key: "overdue", label: "عقب‌افتاده" },
  { key: "completed", label: "تکمیل‌شده" },
  { key: "archived", label: "آرشیو" },
] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const profile = await requireProfile();
  const healthTabs = new Set(["at_risk", "overdue"]);

  let query = supabase.from("projects").select("*").order("created_at", { ascending: false });
  switch (tab) {
    case "active":
      query = query.eq("status", "ACTIVE");
      break;
    case "mine":
      query = query.or(`project_manager_id.eq.${profile.id},owner_user_id.eq.${profile.id}`);
      break;
    case "completed":
      query = query.eq("status", "COMPLETED");
      break;
    case "archived":
      query = query.eq("status", "ARCHIVED");
      break;
    default:
      // "at_risk"/"overdue" (and "همه") need the full set filtered client-side by computed health below.
      break;
  }

  const [{ data }, { data: companies }, { data: summaryRows }] = await Promise.all([
    query,
    supabase.from("companies").select("id, legal_name"),
    supabase.rpc("get_project_progress_summary"),
  ]);

  const summaryMap = new Map(((summaryRows ?? []) as ProjectProgressSummary[]).map((s) => [s.project_id, s]));
  let rows = (data ?? []) as Project[];

  if (healthTabs.has(tab ?? "")) {
    rows = rows.filter((p) => {
      const summary = summaryMap.get(p.id);
      if (!summary) return false;
      const health = computeProjectHealth(p, summary);
      return tab === "at_risk" ? health === "AT_RISK" : health === "DELAYED";
    });
  }

  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]));

  return (
    <div>
      <PageHeader
        title="پروژه‌ها"
        subtitle="مدیریت اجرای پروژه‌ها"
        action={
          <div className="flex gap-2">
            <Link href="/projects/dashboard" className="btn-ghost"><LayoutDashboard className="h-4 w-4" /> داشبورد</Link>
            <Link href="/projects/new" className="btn-seal"><Plus className="h-4 w-4" /> پروژه جدید</Link>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key ? `/projects?tab=${t.key}` : "/projects"} className={cn("btn-ghost", (tab ?? "") === t.key && "border-seal text-seal")}>
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="پروژه‌ای یافت نشد." action={<Link href="/projects/new" className="btn-primary"><Plus className="h-4 w-4" /> پروژه جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">عنوان</th>
              <th className="px-4 py-3">شرکت</th><th className="px-4 py-3">نوع</th>
              <th className="px-4 py-3">پایان برنامه‌ریزی‌شده</th><th className="px-4 py-3">وضعیت</th>
              <th className="px-4 py-3">سلامت</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const summary = summaryMap.get(p.id);
                const health = summary ? computeProjectHealth(p, summary) : null;
                return (
                  <tr key={p.id} className="table-row">
                    <td className="px-4 py-3 tnum font-medium text-ink">
                      <Link href={`/projects/${p.id}`} className="hover:underline">{p.display_number ? toFaDigits(p.display_number) : "پیش‌نویس"}</Link>
                    </td>
                    <td className="px-4 py-3 text-ink">{p.title}</td>
                    <td className="px-4 py-3 text-ink-muted">{p.company_id ? (companyName.get(p.company_id) ?? "—") : "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{PROJECT_TYPE_LABEL[p.project_type as ProjectType]}</td>
                    <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(p.planned_end_date)}</td>
                    <td className="px-4 py-3"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-4 py-3">{health && <ProjectHealthBadge health={health} />}</td>
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

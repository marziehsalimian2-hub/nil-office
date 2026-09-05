import Link from "next/link";
import { Plus, Kanban, ListChecks, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { TaskStatusBadge } from "@/components/TaskStatusBadge";
import { FilterBar } from "./FilterBar";
import { PM_PRIORITY_LABEL, type PmPriority, type TaskStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  projects: { display_number: string | null; title: string } | { display_number: string | null; title: string }[] | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
};

type SearchParams = {
  status?: string;
  priority?: string;
  assigned_to?: string;
  project_id?: string;
  due?: string;
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, projects(display_number, title), profiles!assigned_to(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (sp.status) query = query.eq("status", sp.status);
  if (sp.priority) query = query.eq("priority", sp.priority);
  if (sp.assigned_to) query = query.eq("assigned_to", sp.assigned_to);
  if (sp.project_id === "none") query = query.is("project_id", null);
  else if (sp.project_id) query = query.eq("project_id", sp.project_id);
  if (sp.due === "overdue") query = query.lt("due_date", today).not("status", "in", "(DONE,CANCELLED)");
  else if (sp.due === "today") query = query.eq("due_date", today);
  else if (sp.due === "upcoming") query = query.gt("due_date", today);
  else if (sp.due === "none") query = query.is("due_date", null);

  const [{ data }, { data: profiles }, { data: projects }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
    supabase.from("projects").select("id, title, display_number").order("created_at", { ascending: false }),
  ]);

  const rows = (data ?? []) as Row[];

  return (
    <div>
      <PageHeader
        title="کارها"
        subtitle="همهٔ کارهای ثبت‌شده در سامانه"
        action={
          <div className="flex gap-2">
            <Link href="/tasks/mine" className="btn-ghost"><ListChecks className="h-4 w-4" /> کارهای من</Link>
            <Link href="/tasks/board" className="btn-ghost"><Kanban className="h-4 w-4" /> نمای کانبان</Link>
            <Link href="/tasks/workload" className="btn-ghost"><Users className="h-4 w-4" /> حجم کاری تیم</Link>
            <Link href="/tasks/new" className="btn-seal"><Plus className="h-4 w-4" /> کار جدید</Link>
          </div>
        }
      />
      <FilterBar
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, label: p.display_number ?? p.title }))}
      />
      {rows.length === 0 ? (
        <EmptyState title="کاری با این فیلترها یافت نشد." action={<Link href="/tasks/new" className="btn-primary"><Plus className="h-4 w-4" /> کار جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">عنوان</th><th className="px-4 py-3">پروژه</th>
              <th className="px-4 py-3">مسئول</th><th className="px-4 py-3">اولویت</th>
              <th className="px-4 py-3">مهلت</th><th className="px-4 py-3">وضعیت</th>
            </tr></thead>
            <tbody>
              {rows.map((t) => {
                const project = Array.isArray(t.projects) ? t.projects[0] : t.projects;
                const assignee = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
                return (
                  <tr key={t.id} className="table-row">
                    <td className="px-4 py-3 text-ink"><Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link></td>
                    <td className="px-4 py-3 text-ink-muted">{project ? (project.display_number ?? project.title) : "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{assignee?.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{PM_PRIORITY_LABEL[t.priority as PmPriority]}</td>
                    <td className="px-4 py-3 tnum text-ink-muted">{t.due_date ? formatJalali(t.due_date) : "—"}</td>
                    <td className="px-4 py-3"><TaskStatusBadge status={t.status as TaskStatus} /></td>
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

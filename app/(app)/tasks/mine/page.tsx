import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { TaskStatusBadge } from "@/components/TaskStatusBadge";
import { PM_PRIORITY_LABEL, type PmPriority } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { Task } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function TaskSection({ title, tasks, emptyLabel }: { title: string; tasks: Task[]; emptyLabel: string }) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">{title} <span className="tnum text-ink-muted">({tasks.length})</span></p>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1">
                <Link href={`/tasks/${t.id}`} className="text-sm text-seal hover:underline">{t.title}</Link>
                {t.due_date && <p className="mt-0.5 text-xs text-ink-muted tnum">{formatJalali(t.due_date)}</p>}
              </div>
              <span className="text-xs text-ink-muted">{PM_PRIORITY_LABEL[t.priority as PmPriority]}</span>
              <TaskStatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function MyTasksPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const base = () => supabase.from("tasks").select("*").eq("assigned_to", profile.id);

  const [
    { data: overdue },
    { data: todayTasks },
    { data: thisWeek },
    { data: inProgress },
    { data: blocked },
    { data: noDueDate },
    { data: recentlyCompleted },
  ] = await Promise.all([
    base().lt("due_date", today).not("status", "in", "(DONE,CANCELLED)").order("due_date"),
    base().eq("due_date", today).not("status", "in", "(DONE,CANCELLED)"),
    base().gt("due_date", today).lte("due_date", weekEnd).not("status", "in", "(DONE,CANCELLED)").order("due_date"),
    base().eq("status", "IN_PROGRESS"),
    base().eq("status", "BLOCKED"),
    base().is("due_date", null).not("status", "in", "(DONE,CANCELLED)"),
    base().eq("status", "DONE").order("completed_at", { ascending: false }).limit(10),
  ]);

  return (
    <div>
      <PageHeader
        title="کارهای من"
        subtitle="فضای کاری روزانهٔ شما"
        action={<Link href="/tasks/new" className="btn-seal"><Plus className="h-4 w-4" /> کار جدید</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <TaskSection title="عقب‌افتاده" tasks={(overdue ?? []) as Task[]} emptyLabel="کار عقب‌افتاده‌ای ندارید." />
        <TaskSection title="امروز" tasks={(todayTasks ?? []) as Task[]} emptyLabel="برای امروز کاری ثبت نشده است." />
        <TaskSection title="این هفته" tasks={(thisWeek ?? []) as Task[]} emptyLabel="برای این هفته کاری ثبت نشده است." />
        <TaskSection title="در حال انجام" tasks={(inProgress ?? []) as Task[]} emptyLabel="کاری در حال انجام ندارید." />
        <TaskSection title="مسدود" tasks={(blocked ?? []) as Task[]} emptyLabel="کار مسدودی ندارید." />
        <TaskSection title="بدون تاریخ" tasks={(noDueDate ?? []) as Task[]} emptyLabel="کار بدون‌تاریخی ندارید." />
        <TaskSection title="اخیراً تکمیل‌شده" tasks={(recentlyCompleted ?? []) as Task[]} emptyLabel="اخیراً کاری تکمیل نکرده‌اید." />
      </div>
    </div>
  );
}

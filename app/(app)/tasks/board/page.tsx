import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { BoardClient } from "./BoardClient";
import type { TaskStatus, PmPriority } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function TaskBoardPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, projects(display_number, title), profiles!assigned_to(full_name)")
    .not("status", "eq", "CANCELLED")
    .order("created_at", { ascending: false });

  type Row = {
    id: string; title: string; status: string; priority: string; due_date: string | null;
    projects: { display_number: string | null; title: string } | { display_number: string | null; title: string }[] | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const cards = ((data ?? []) as Row[]).map((t) => {
    const project = Array.isArray(t.projects) ? t.projects[0] : t.projects;
    const assignee = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
    return {
      id: t.id,
      title: t.title,
      status: t.status as TaskStatus,
      priority: t.priority as PmPriority,
      due_date: t.due_date,
      projectLabel: project ? (project.display_number ?? project.title) : null,
      assigneeName: assignee?.full_name ?? null,
    };
  });

  return (
    <div>
      <PageHeader title="کانبان کارها" subtitle="کارها را بین وضعیت‌ها جابه‌جا کنید" />
      <BoardClient cards={cards} />
    </div>
  );
}

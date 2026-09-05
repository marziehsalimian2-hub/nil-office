import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TaskForm } from "../../new/TaskForm";
import type { Task } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
  if (!task) notFound();
  const t = task as Task;

  const [{ data: profiles }, { data: projects }, { data: parentTasks }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
    supabase.from("projects").select("id, title, display_number").order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title").is("parent_task_id", null).neq("id", id).order("created_at", { ascending: false }).limit(200),
  ]);

  return (
    <div>
      <PageHeader title="ویرایش کار" subtitle={t.title} />
      <TaskForm
        docId={id}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, label: p.display_number ?? p.title }))}
        parentTasks={(parentTasks ?? []).map((pt) => ({ id: pt.id, label: pt.title }))}
        initial={{
          title: t.title,
          description: t.description,
          project_id: t.project_id,
          assigned_to: t.assigned_to,
          status: t.status,
          priority: t.priority,
          start_date: t.start_date,
          due_date: t.due_date,
          estimated_minutes: t.estimated_minutes,
          actual_minutes: t.actual_minutes,
          parent_task_id: t.parent_task_id,
          blocked_reason: t.blocked_reason,
        }}
      />
    </div>
  );
}

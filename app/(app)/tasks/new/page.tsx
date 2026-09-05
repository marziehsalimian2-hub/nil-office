import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { TaskForm } from "./TaskForm";

export const dynamic = "force-dynamic";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; parent_id?: string }>;
}) {
  const { project_id, parent_id } = await searchParams;
  const supabase = await createClient();
  const [{ data: profiles }, { data: projects }, { data: parentTasks }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
    supabase.from("projects").select("id, title, display_number").order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title").is("parent_task_id", null).order("created_at", { ascending: false }).limit(200),
  ]);

  return (
    <div>
      <PageHeader title="کار جدید" subtitle="ثبت یک کار جدید" />
      <TaskForm
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, label: p.display_number ?? p.title }))}
        parentTasks={(parentTasks ?? []).map((t) => ({ id: t.id, label: t.title }))}
        defaultProjectId={project_id}
        defaultParentTaskId={parent_id}
      />
    </div>
  );
}

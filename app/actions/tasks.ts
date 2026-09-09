"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { taskSchema } from "@/lib/validation-tasks";

export type ActionState = { error?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}
const entries = (f: FormData) => Object.fromEntries(f.entries());

function taskPayload(d: ReturnType<typeof taskSchema.parse>) {
  return {
    title: d.title,
    description: d.description ?? null,
    project_id: d.project_id ?? null,
    phase_id: d.phase_id ?? null,
    milestone_id: d.milestone_id ?? null,
    company_id: d.company_id ?? null,
    case_id: d.case_id ?? null,
    crm_opportunity_id: d.crm_opportunity_id ?? null,
    contract_id: d.contract_id ?? null,
    assigned_to: d.assigned_to ?? null,
    status: d.status,
    priority: d.priority,
    start_date: d.start_date ?? null,
    due_date: d.due_date ?? null,
    estimated_minutes: d.estimated_minutes ?? null,
    actual_minutes: d.actual_minutes ?? null,
    parent_task_id: d.parent_task_id ?? null,
    blocked_reason: d.status === "BLOCKED" ? (d.blocked_reason ?? null) : null,
  };
}

/**
 * Non-redirecting core shared by the form action below and NIL
 * Assistant's CREATE_TASK_DRAFT action (lib/assistant/actions/task.ts).
 * Next's redirect() throws a special control-flow error that only a
 * page-render/form-action caller can catch correctly — a programmatic
 * caller like the Assistant action registry needs a plain return value,
 * so the redirect stays here, in the thin wrapper, not in the shared core.
 */
export async function insertTaskDraftCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  d: ReturnType<typeof taskSchema.parse>,
): Promise<{ data: { id: string } } | { error: string }> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...taskPayload(d), created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  revalidatePath("/tasks");
  revalidatePath("/tasks/mine");
  if (d.project_id) revalidatePath(`/projects/${d.project_id}`);
  return { data };
}

export async function createTask(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = taskSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const result = await insertTaskDraftCore(supabase, userId, parsed.data);
  if ("error" in result) return { error: result.error };
  redirect(`/tasks/${result.data.id}`);
}

export async function updateTask(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه کار نامعتبر است." };
  const parsed = taskSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const payload = taskPayload(parsed.data);
  const { error } = await supabase
    .from("tasks")
    .update({ ...payload, completed_at: payload.status === "DONE" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/tasks/${id}`);
  revalidatePath("/tasks");
  revalidatePath("/tasks/mine");
  if (parsed.data.project_id) revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

/** Kanban drag/status-only update — no numbering/finality concerns, so a plain update suffices. */
export async function moveTaskStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  if (!id || !status) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("tasks")
    .update({ status, completed_at: status === "DONE" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/tasks");
  revalidatePath("/tasks/mine");
  revalidatePath("/tasks/board");
  return null;
}

export async function deleteTask(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  if (!id) return { error: "شناسه کار نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/tasks");
  revalidatePath("/tasks/mine");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}

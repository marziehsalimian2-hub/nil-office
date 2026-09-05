"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { milestoneSchema } from "@/lib/validation-projects";

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

function milestonePayload(d: ReturnType<typeof milestoneSchema.parse>) {
  return {
    project_id: d.project_id,
    phase_id: d.phase_id ?? null,
    title: d.title,
    description: d.description ?? null,
    due_date: d.due_date ?? null,
    status: d.status,
    priority: d.priority,
    responsible_user_id: d.responsible_user_id ?? null,
  };
}

export async function createMilestone(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = milestoneSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("project_milestones").insert({ ...milestonePayload(parsed.data), created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

export async function updateMilestone(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه مایلستون نامعتبر است." };
  const parsed = milestoneSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const payload = milestonePayload(parsed.data);
  const { error } = await supabase
    .from("project_milestones")
    .update({ ...payload, completed_at: payload.status === "COMPLETED" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

export async function deleteMilestone(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  if (!id) return { error: "شناسه مایلستون نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("project_milestones").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}

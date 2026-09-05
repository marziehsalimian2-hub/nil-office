"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { checklistItemSchema } from "@/lib/validation-tasks";

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

export async function addChecklistItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = checklistItemSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("task_checklist_items").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return null;
}

export async function toggleChecklistItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const taskId = String(f.get("task_id") ?? "");
  const isDone = String(f.get("is_done") ?? "") === "true";
  if (!id) return { error: "شناسه آیتم نامعتبر است." };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("task_checklist_items")
    .update({
      is_done: isDone,
      completed_by: isDone ? userId : null,
      completed_at: isDone ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  return null;
}

export async function deleteChecklistItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const taskId = String(f.get("task_id") ?? "");
  if (!id) return { error: "شناسه آیتم نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("task_checklist_items").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  return null;
}

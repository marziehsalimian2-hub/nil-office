"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { dependencySchema } from "@/lib/validation-tasks";

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

export async function addDependency(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = dependencySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("task_dependencies").insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return null;
}

export async function removeDependency(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const taskId = String(f.get("task_id") ?? "");
  if (!id) return { error: "شناسه نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("task_dependencies").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  return null;
}

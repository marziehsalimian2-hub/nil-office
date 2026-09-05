"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { phaseSchema } from "@/lib/validation-projects";

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

export async function createPhase(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = phaseSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("project_phases").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

export async function updatePhase(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه فاز نامعتبر است." };
  const parsed = phaseSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("project_phases").update(parsed.data).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

export async function deletePhase(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  if (!id) return { error: "شناسه فاز نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("project_phases").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}

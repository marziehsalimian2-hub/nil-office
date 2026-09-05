"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { commentSchema } from "@/lib/validation-tasks";

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

export async function createComment(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = commentSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("task_comments").insert({ ...parsed.data, author_user_id: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return null;
}

/** Author-only — RLS already guarantees this; re-checked here for a clean error message. */
export async function updateComment(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه پیام نامعتبر است." };
  const parsed = commentSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();

  const { data: current } = await supabase.from("task_comments").select("author_user_id").eq("id", id).single();
  if (!current) return { error: "پیام یافت نشد." };
  if (current.author_user_id !== userId) return { error: "فقط نویسنده می‌تواند این پیام را ویرایش کند." };

  const { error } = await supabase.from("task_comments").update({ body: parsed.data.body }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return null;
}

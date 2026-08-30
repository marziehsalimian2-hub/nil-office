"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  companySchema,
  caseSchema,
  documentSchema,
  followupSchema,
} from "@/lib/validation";
import { persianError } from "@/lib/enums";

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

export async function createCompany(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = companySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("companies")
    .insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/companies");
  redirect("/companies");
}

export async function createCase(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = entries(f);
  const parsed = caseSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { tags, ...rest } = parsed.data;
  const tagArray = tags
    ? tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean)
    : [];
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("cases")
    .insert({ ...rest, tags: tagArray, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/cases");
  redirect("/cases");
}

export async function createDocument(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = documentSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("documents")
    .insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/documents");
  redirect("/documents");
}

export async function createFollowup(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = followupSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("followups")
    .insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/followups");
  redirect("/followups");
}

export async function completeFollowup(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("followups")
    .update({ status: "DONE", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/followups");
  return null;
}

/** Admin-only: set the last-used number for a scope/year (deployment init). */
export async function initSequence(_p: ActionState, f: FormData): Promise<ActionState> {
  const scope = String(f.get("scope") ?? "");
  const year = Number(f.get("year") ?? 0);
  const lastValue = Number(f.get("last_value") ?? 0);
  if (!["OUTGOING", "INCOMING", "CASE"].includes(scope))
    return { error: "دامنه نامعتبر است." };
  if (!year || year < 1300 || year > 1600) return { error: "سال نامعتبر است." };
  if (lastValue < 0) return { error: "مقدار نامعتبر است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("init_number_sequence", {
    p_scope: scope,
    p_year: year,
    p_last_value: lastValue,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}

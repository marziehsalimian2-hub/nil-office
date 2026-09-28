"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { timeEntrySchema } from "@/lib/validation-service-ledger";

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

/**
 * Writes the public time_entries row, then snapshots the confidential
 * internal cost rate into the SEPARATE time_entry_internal_costs table
 * (see 0084/0086's own comments for why this can't be a plain column —
 * one shared "authenticated" Postgres role means per-user column
 * visibility can only come from RLS on a distinct table). The raw rate
 * from get_internal_cost_rate_for_snapshot is used ONLY to compute and
 * store internal_cost_amount here — it is never put on this function's
 * own return value, so no caller (including the NIL Assistant executor
 * map) can accidentally leak it back to a chat reply or a browser
 * response.
 */
export async function addTimeEntryDraftCore(
  supabase: SupabaseClient,
  userId: string,
  d: ReturnType<typeof timeEntrySchema.parse>,
): Promise<{ data: { id: string } } | { error: string }> {
  const { data, error } = await supabase
    .from("time_entries")
    .insert({ ...d, created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  const { data: rate } = await supabase.rpc("get_internal_cost_rate_for_snapshot", { p_profile_id: d.performed_by });
  if (typeof rate === "number") {
    const internalCostAmount = rate * (d.duration_minutes / 60);
    // Best-effort: a configured internal cost rate is optional (spec's
    // own "not every employee has one yet" reality) — a failure here
    // never blocks the (already-committed) time entry itself.
    await supabase.from("time_entry_internal_costs").insert({
      time_entry_id: data.id,
      internal_cost_rate_snapshot: rate,
      internal_cost_amount: internalCostAmount,
    });
  }

  return { data };
}

export async function createTimeEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = timeEntrySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const result = await addTimeEntryDraftCore(supabase, userId, parsed.data);
  if ("error" in result) return { error: result.error };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export async function deleteTimeEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسهٔ رکورد زمان نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

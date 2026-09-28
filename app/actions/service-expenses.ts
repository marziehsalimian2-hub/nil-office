"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { expenseSchema, waiveExpenseSchema } from "@/lib/validation-service-ledger";

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

/** Mirrors insertServiceEntryDraftCore's shape — shared by the web form and NIL Assistant's ADD_SERVICE_EXPENSE_DRAFT action. */
export async function addServiceExpenseDraftCore(
  supabase: SupabaseClient,
  userId: string,
  d: ReturnType<typeof expenseSchema.parse>,
): Promise<{ data: { id: string } } | { error: string }> {
  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...d, created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  return { data };
}

export async function createServiceExpense(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = expenseSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const result = await addServiceExpenseDraftCore(supabase, userId, parsed.data);
  if ("error" in result) return { error: result.error };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export async function deleteServiceExpense(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسهٔ هزینه نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

/** Symmetric to bulkMarkServiceEntriesReadyToBill (app/actions/service-entries.ts) — expenses are billed exactly like services in Phase 2, not deferred. */
export async function bulkMarkServiceExpensesReadyToBill(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  let ids: string[];
  try {
    ids = JSON.parse(String(f.get("ids") ?? "[]"));
  } catch {
    return { error: "شناسه‌های نامعتبر." };
  }
  if (!Array.isArray(ids) || ids.length === 0) return { error: "هیچ هزینه‌ای انتخاب نشده است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("expenses").update({ billing_status: "READY_TO_BILL" }).in("id", ids);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export async function waiveServiceExpense(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = waiveExpenseSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("expenses")
    .update({ billing_status: "WAIVED", waived_reason: parsed.data.reason, waived_by: userId, waived_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  approveBatchSchema, reopenBatchSchema, accountingSettingsSchema, componentAccountsSchema,
} from "@/lib/validation-payroll";

export type ActionState = { error?: string; ok?: boolean } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}
const entries = (f: FormData) => Object.fromEntries(f.entries());

export async function approveBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = approveBatchSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("approve_payroll_batch", { p_batch_id: d.batch_id, p_note: d.note ?? null });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${d.batch_id}`);
  return { ok: true };
}

export async function reopenBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = reopenBatchSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("reopen_payroll_batch", { p_batch_id: d.batch_id, p_reason: d.reason });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${d.batch_id}`);
  return { ok: true };
}

export async function savePayrollAccountingSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = accountingSettingsSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("set_payroll_accounting_settings", {
    p_base_salary_expense: d.base_salary_expense,
    p_net_payable: d.net_payable,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/payroll/accounting");
  return { ok: true };
}

export async function savePayrollComponentAccounts(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = componentAccountsSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("set_payroll_component_accounts", {
    p_component_id: d.component_id,
    p_expense: d.expense ?? null,
    p_liability: d.liability ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/payroll/accounting");
  return { ok: true };
}

/** Creates the DRAFT journal entry only — posting stays Accounting's own authorised flow. */
export async function createPayrollAccountingDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("create_payroll_accounting_draft", { p_batch_id: batchId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${batchId}`);
  return { ok: true };
}

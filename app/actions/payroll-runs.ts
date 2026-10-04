"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { jalaliMonthRange } from "@/lib/payroll/period";
import {
  payrollPeriodSchema, payrollBatchSchema, batchSettingsSchema, eligibilityOverrideSchema,
  batchStatusSchema, workDataRowsSchema,
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

/** Period boundaries are computed HERE (authoritative Jalali calendar); the DB only sanity-checks them. */
export async function createPayrollPeriod(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = payrollPeriodSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { jalali_year, jalali_month } = parsed.data;
  const range = jalaliMonthRange(jalali_year, jalali_month);
  const { data, error } = await supabase.rpc("create_payroll_period", {
    p_jalali_year: jalali_year,
    p_jalali_month: jalali_month,
    p_period_start: range.start,
    p_period_end: range.end,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/payroll/periods");
  redirect(`/payroll/periods/${data.id}`);
}

/** The grid posts only dirty rows as one JSON string; quantities/amounts stay exact strings end to end. */
export async function saveWorkDataRows(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = workDataRowsSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { period_id, rows } = parsed.data;
  const { error } = await supabase.rpc("save_payroll_work_data_rows", { p_period_id: period_id, p_rows: rows });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/periods/${period_id}`);
  return { ok: true };
}

export async function createPayrollBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = payrollBatchSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { data, error } = await supabase.rpc("create_payroll_batch", {
    p_period_id: d.period_id,
    p_currency: d.currency,
    p_rounding_scale: d.rounding_scale,
    p_rounding_mode: d.rounding_mode,
    p_jurisdiction: d.jurisdiction ?? null,
    p_notes: d.notes ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/periods/${d.period_id}`);
  redirect(`/payroll/batches/${data.id}`);
}

export async function updateBatchSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = batchSettingsSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("update_payroll_batch_settings", {
    p_batch_id: d.batch_id,
    p_jurisdiction: d.jurisdiction ?? null,
    p_rounding_scale: d.rounding_scale,
    p_rounding_mode: d.rounding_mode,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${d.batch_id}`);
  return { ok: true };
}

export async function setEligibilityOverride(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = eligibilityOverrideSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("set_payroll_eligibility_override", {
    p_batch_id: d.batch_id,
    p_personnel_id: d.personnel_id,
    p_decision: d.decision,
    p_reason: d.reason ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${d.batch_id}`);
  return { ok: true };
}

export async function calculateBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("calculate_payroll_batch", { p_batch_id: batchId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${batchId}`);
  return { ok: true };
}

export async function changeBatchStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = batchStatusSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("change_payroll_batch_status", {
    p_batch_id: d.batch_id,
    p_new_status: d.new_status,
    p_note: d.note ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${d.batch_id}`);
  return { ok: true };
}

export async function markBatchReviewed(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("mark_payroll_batch_reviewed", { p_batch_id: batchId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${batchId}`);
  return { ok: true };
}

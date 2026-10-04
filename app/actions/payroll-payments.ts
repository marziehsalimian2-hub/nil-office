"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { paymentDraftsSchema } from "@/lib/validation-payroll";

export type ActionState = { error?: string; ok?: boolean } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

/**
 * Creates DRAFT payments (one per selected employee) in the existing Financial Receipts & Payments module.
 * Amounts travel as exact strings. Verification and posting stay Accounting's own flow.
 */
export async function createPayrollPaymentDrafts(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = paymentDraftsSchema.safeParse(Object.fromEntries(f.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("create_payroll_payment_drafts", {
    p_batch_id: d.batch_id,
    p_bank_account_id: d.bank_account_id,
    p_payment_date: d.payment_date,
    p_method: d.method ?? null,
    p_items: d.items,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${d.batch_id}`);
  return { ok: true };
}

/** Deletes the batch's DRAFT payments only; POSTED payments are reversed in Accounting. */
export async function discardPayrollPaymentDrafts(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("discard_payroll_payment_drafts", { p_batch_id: batchId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/batches/${batchId}`);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { persianError } from "@/lib/enums";
import { payrollAccess } from "@/lib/payroll/access";
import { compensationVersionSchema, paymentDestinationSchema } from "@/lib/validation-payroll";

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
const BANK_DENIED = "اطلاعات حساب بانکی فقط برای مدیر حقوق و دستمزد در دسترس است.";

/** New compensation version (the RPC closes the previous one and pins component versions in force on the start date). */
export async function createCompensationVersion(_p: ActionState, f: FormData): Promise<ActionState> {
  const personnelId = String(f.get("personnel_id") ?? "");
  if (!personnelId) return { error: "شناسهٔ پرسنل نامعتبر است." };
  const parsed = compensationVersionSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("create_compensation_version", {
    p_personnel_id: personnelId,
    p_effective_from: d.effective_from,
    p_base_salary: d.base_salary,
    p_currency: d.currency,
    p_payment_frequency: d.payment_frequency,
    p_hourly_rate: d.hourly_rate ?? null,
    p_notes: d.notes ?? null,
    p_lines: d.lines.map((l) => ({
      component_id: l.component_id,
      amount_override: l.amount_override ?? null,
      percentage_override: l.percentage_override ?? null,
      notes: l.notes || null,
    })),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${personnelId}`);
  return null;
}

export async function addPaymentDestination(_p: ActionState, f: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!payrollAccess(profile).bank) return { error: BANK_DENIED };
  const personnelId = String(f.get("personnel_id") ?? "");
  if (!personnelId) return { error: "شناسهٔ پرسنل نامعتبر است." };
  const parsed = paymentDestinationSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("add_payment_destination", {
    p_personnel_id: personnelId,
    p_bank_name: d.bank_name,
    p_account_holder_name: d.account_holder_name,
    p_account_number: d.account_number ?? null,
    p_iban: d.iban ?? null,
    p_card_number: d.card_number ?? null,
    p_is_primary: d.is_primary,
    p_notes: d.notes ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${personnelId}`);
  return null;
}

async function destinationAction(
  rpc: "set_primary_payment_destination" | "deactivate_payment_destination",
  f: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!payrollAccess(profile).bank) return { error: BANK_DENIED };
  const id = String(f.get("id") ?? "");
  const personnelId = String(f.get("personnel_id") ?? "");
  if (!id) return { error: "شناسهٔ حساب نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc(rpc, { p_id: id });
  if (error) return { error: persianError(error.message) };
  if (personnelId) revalidatePath(`/personnel/${personnelId}`);
  return null;
}
export async function setPrimaryPaymentDestination(_p: ActionState, f: FormData) {
  return destinationAction("set_primary_payment_destination", f);
}
export async function deactivatePaymentDestination(_p: ActionState, f: FormData) {
  return destinationAction("deactivate_payment_destination", f);
}

/** Full values are only ever returned through this audited RPC (the audit row carries no values). */
export async function revealPaymentDestination(
  id: string,
): Promise<{ error?: string; data?: { account_number: string | null; iban: string | null; card_number: string | null } }> {
  const profile = await requireProfile();
  if (!payrollAccess(profile).bank) return { error: BANK_DENIED };
  if (!id) return { error: "شناسهٔ حساب نامعتبر است." };
  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("reveal_payment_destination", { p_id: id });
  if (error) return { error: persianError(error.message) };
  return { data: data as { account_number: string | null; iban: string | null; card_number: string | null } };
}

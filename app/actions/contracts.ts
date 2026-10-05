"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { contractSchema, contractRoleSchema, contractTypeSchema } from "@/lib/validation-contracts";
import { persianError } from "@/lib/enums";
import { currentJalaliYear } from "@/lib/jalali";

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

/** Create a contract draft — or, for a historical/external contract, insert
 * it directly at its real-world status (never numbered). */
export async function createContractDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = contractSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  const d = parsed.data;

  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      title: d.title,
      contract_type_id: d.contract_type_id,
      party_company_id: d.party_company_id ?? null,
      party_contact_name: d.party_contact_name ?? null,
      case_id: d.case_id ?? null,
      contract_date: d.contract_date ?? null,
      effective_date: d.effective_date ?? null,
      start_date: d.start_date ?? null,
      end_date: d.end_date ?? null,
      currency_code: d.currency_code,
      base_amount: d.base_amount ?? null,
      tax_amount: d.tax_amount ?? null,
      total_amount: d.total_amount ?? null,
      responsible_user_id: d.responsible_user_id ?? null,
      requires_guarantee: d.requires_guarantee,
      auto_renewal: d.auto_renewal,
      description: d.description ?? null,
      internal_notes: d.internal_notes ?? null,
      is_historical: d.is_historical,
      original_contract_number: d.original_contract_number ?? null,
      original_contract_date: d.original_contract_date ?? null,
      status: d.is_historical ? (d.historical_status ?? "ACTIVE") : "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) return { error: persianError(error.message) };
  revalidatePath("/contracts");
  redirect(`/contracts/${data.id}`);
}

/** Update a contract's fields — only while still DRAFT or UNDER_REVIEW. */
export async function updateContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };

  const parsed = contractSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  const d = parsed.data;

  const { supabase } = await ctx();
  const { data: current } = await supabase.from("contracts").select("status").eq("id", id).single();
  if (!current || !["DRAFT", "UNDER_REVIEW"].includes(current.status)) {
    return { error: "این قرارداد دیگر قابل ویرایش نیست." };
  }

  const { error } = await supabase
    .from("contracts")
    .update({
      title: d.title,
      contract_type_id: d.contract_type_id,
      party_company_id: d.party_company_id ?? null,
      party_contact_name: d.party_contact_name ?? null,
      case_id: d.case_id ?? null,
      contract_date: d.contract_date ?? null,
      effective_date: d.effective_date ?? null,
      start_date: d.start_date ?? null,
      end_date: d.end_date ?? null,
      currency_code: d.currency_code,
      base_amount: d.base_amount ?? null,
      tax_amount: d.tax_amount ?? null,
      total_amount: d.total_amount ?? null,
      responsible_user_id: d.responsible_user_id ?? null,
      requires_guarantee: d.requires_guarantee,
      auto_renewal: d.auto_renewal,
      description: d.description ?? null,
      internal_notes: d.internal_notes ?? null,
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/contracts/${id}`);
  return null;
}

/** Move a draft to UNDER_REVIEW. */
export async function sendContractForReview(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.from("contracts").update({ status: "UNDER_REVIEW" }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  return null;
}

/** Send an UNDER_REVIEW contract back to DRAFT for revision. */
export async function returnContractToDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.from("contracts").update({ status: "DRAFT" }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  return null;
}

async function runRpc(fn: string, args: Record<string, unknown>, id: string): Promise<ActionState> {
  const { supabase } = await ctx();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return null;
}

/** Approve an UNDER_REVIEW contract and issue its official CTR-.... number. */
export async function approveContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  return runRpc("approve_contract", { p_contract_id: id, p_year: currentJalaliYear() }, id);
}

export async function activateContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  return runRpc("activate_contract", { p_contract_id: id }, id);
}

export async function suspendContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  return runRpc("suspend_contract", { p_contract_id: id }, id);
}

export async function resumeContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  return runRpc("resume_contract", { p_contract_id: id }, id);
}

export async function completeContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  return runRpc("complete_contract", { p_contract_id: id }, id);
}

export async function terminateContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  const reason = String(f.get("reason") ?? "").trim() || null;
  return runRpc("terminate_contract", { p_contract_id: id, p_reason: reason }, id);
}

export async function cancelContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };
  const reason = String(f.get("reason") ?? "").trim() || null;
  return runRpc("cancel_contract", { p_contract_id: id, p_reason: reason }, id);
}

/** Admin-only: grant/revoke a user's contract permission level. */
export async function setContractRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), contract_role: f.get("contract_role") || null };
  const parsed = contractRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ contract_role: parsed.data.contract_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}

/** Admin-only: add a new contract type to the lookup list. */
export async function createContractType(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = contractTypeSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("contract_types").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}

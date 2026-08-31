"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { currentJalaliYear } from "@/lib/jalali";
import { contractSchema, contractTypeSchema, contractRoleSchema } from "@/lib/validation-contracts";

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

/** Simple (non-numbering) status transitions a plain update may perform. */
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["DRAFT"],
  ACTIVE: ["SUSPENDED", "COMPLETED", "EXPIRED", "TERMINATED"],
  SUSPENDED: ["ACTIVE", "TERMINATED"],
};

/** Create a contract as DRAFT — no number is issued until approval. */
export async function createContractDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = contractSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const d = parsed.data;
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      title: d.title,
      contract_type_id: d.contract_type_id,
      kind: d.kind,
      external_contract_number: d.external_contract_number ?? null,
      external_source_note: d.external_source_note ?? null,
      counterparty_company_id: d.counterparty_company_id ?? null,
      case_id: d.case_id ?? null,
      effective_date: d.effective_date ?? null,
      expiry_date: d.expiry_date ?? null,
      signed_date: d.signed_date ?? null,
      base_amount: d.base_amount ?? null,
      discount_amount: d.discount_amount ?? 0,
      tax_amount: d.tax_amount ?? 0,
      currency_code: d.currency_code,
      description: d.description ?? null,
      internal_notes: d.internal_notes ?? null,
      responsible_user: d.responsible_user ?? null,
      status: "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  revalidatePath("/contracts");
  redirect(`/contracts/${data.id}`);
}

/** Update a contract's editable fields — only while DRAFT or UNDER_REVIEW. */
export async function updateContractDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه قرارداد نامعتبر است." };

  const parsed = contractSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase } = await ctx();
  const { data: current } = await supabase.from("contracts").select("status").eq("id", id).single();
  if (!current || !["DRAFT", "UNDER_REVIEW"].includes(current.status)) {
    return { error: "این قرارداد دیگر قابل ویرایش نیست." };
  }

  const d = parsed.data;
  const { error } = await supabase
    .from("contracts")
    .update({
      title: d.title,
      contract_type_id: d.contract_type_id,
      external_contract_number: d.external_contract_number ?? null,
      external_source_note: d.external_source_note ?? null,
      counterparty_company_id: d.counterparty_company_id ?? null,
      case_id: d.case_id ?? null,
      effective_date: d.effective_date ?? null,
      expiry_date: d.expiry_date ?? null,
      signed_date: d.signed_date ?? null,
      base_amount: d.base_amount ?? null,
      discount_amount: d.discount_amount ?? 0,
      tax_amount: d.tax_amount ?? 0,
      currency_code: d.currency_code,
      description: d.description ?? null,
      internal_notes: d.internal_notes ?? null,
      responsible_user: d.responsible_user ?? null,
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/contracts/${id}`);
  return null;
}

/**
 * Advance a simple (non-numbering) status transition — DRAFT<->UNDER_REVIEW,
 * ACTIVE->{SUSPENDED,COMPLETED,EXPIRED,TERMINATED}, SUSPENDED<->{ACTIVE,TERMINATED}.
 * A HISTORICAL contract may additionally go UNDER_REVIEW->APPROVED here since
 * it never receives an internal sequence number; a NIL_ISSUED contract must
 * use approveContract (finalize_contract RPC) to reach APPROVED.
 */
export async function setContractStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  const { supabase, userId } = await ctx();

  const { data: current } = await supabase.from("contracts").select("status, kind").eq("id", id).single();
  if (!current) return { error: "قرارداد یافت نشد." };

  const isHistoricalApproval =
    current.kind === "HISTORICAL" && current.status === "UNDER_REVIEW" && status === "APPROVED";
  const allowed = isHistoricalApproval || (SIMPLE_TRANSITIONS[current.status] ?? []).includes(status);
  if (!allowed) return { error: "تغییر وضعیت در این مرحله مجاز نیست." };

  const patch: Record<string, unknown> = { status };
  if (isHistoricalApproval) {
    patch.approved_by = userId;
    patch.approved_at = new Date().toISOString();
  }

  const { error } = await supabase.from("contracts").update(patch).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return null;
}

/** Atomically approve a NIL_ISSUED contract and issue its official number. */
export async function approveContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("finalize_contract", {
    p_contract_id: id,
    p_year: currentJalaliYear(),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return null;
}

/** APPROVED -> ACTIVE. */
export async function activateContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("activate_contract", { p_contract_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return null;
}

/** Cancel a contract — only reachable pre-ACTIVE; keeps any assigned number. */
export async function cancelContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("cancel_contract", { p_contract_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return null;
}

/* ------------------------------- contract types -------------------------- */
export async function createContractType(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = contractTypeSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("contract_types").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/contracts/types");
  redirect("/contracts/types");
}

/* ------------------------------- settings --------------------------------- */
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  legalRuleSetSchema, legalRuleSetHeaderSchema, legalRuleEntrySchema, legalRuleSetStatusSchema,
} from "@/lib/validation-payroll";

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

export async function createLegalRuleSet(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = legalRuleSetSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { data, error } = await supabase.rpc("create_legal_rule_set", {
    p_name: d.name,
    p_jurisdiction: d.jurisdiction,
    p_effective_from: d.effective_from,
    p_effective_to: d.effective_to ?? null,
    p_source_reference: d.source_reference ?? null,
    p_copy_from_id: d.copy_from_id ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/payroll/rule-sets");
  redirect(`/payroll/rule-sets/${data.id}`);
}

export async function updateLegalRuleSetHeader(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ مجموعه نامعتبر است." };
  const parsed = legalRuleSetHeaderSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("update_legal_rule_set_header", {
    p_id: id,
    p_effective_from: d.effective_from,
    p_effective_to: d.effective_to ?? null,
    p_source_reference: d.source_reference ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/rule-sets/${id}`);
  return null;
}

export async function upsertLegalRuleEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const ruleSetId = String(f.get("rule_set_id") ?? "");
  if (!ruleSetId) return { error: "شناسهٔ مجموعه نامعتبر است." };
  const parsed = legalRuleEntrySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("upsert_legal_rule_entry", {
    p_rule_set_id: ruleSetId,
    p_rule_key: d.rule_key,
    p_value_numeric: d.value_numeric ?? null,
    p_value_json: d.value_json !== undefined ? JSON.parse(d.value_json) : null,
    p_unit: d.unit ?? null,
    p_description: d.description ?? null,
    p_source_reference: d.source_reference ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/rule-sets/${ruleSetId}`);
  return null;
}

export async function deleteLegalRuleEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const entryId = String(f.get("entry_id") ?? "");
  const ruleSetId = String(f.get("rule_set_id") ?? "");
  if (!entryId) return { error: "شناسهٔ قاعده نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("delete_legal_rule_entry", { p_entry_id: entryId });
  if (error) return { error: persianError(error.message) };
  if (ruleSetId) revalidatePath(`/payroll/rule-sets/${ruleSetId}`);
  return null;
}

/** Thin RPC call — transitions and tier gating live in change_legal_rule_set_status (0116). */
export async function changeLegalRuleSetStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ مجموعه نامعتبر است." };
  const parsed = legalRuleSetStatusSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("change_legal_rule_set_status", {
    p_id: id,
    p_new_status: parsed.data.new_status,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/rule-sets/${id}`);
  revalidatePath("/payroll/rule-sets");
  return null;
}

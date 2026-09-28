"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { persianError, CURRENCY } from "@/lib/enums";
import { serviceEntrySchema, quickAddServiceEntrySchema, waiveServiceEntrySchema } from "@/lib/validation-service-ledger";

type ServiceLedgerCurrency = (typeof CURRENCY)[number];
import { addTimeEntryDraftCore } from "@/app/actions/service-time-entries";
import { addServiceExpenseDraftCore } from "@/app/actions/service-expenses";

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
 * Non-redirecting core shared by the web form and NIL Assistant's
 * CREATE_SERVICE_ENTRY_DRAFT action — mirrors insertTaskDraftCore's
 * exact shape (app/actions/tasks.ts). Status stays DRAFT; no numbering,
 * no finalize RPC (a Service Entry isn't an "issued" document like an
 * invoice/contract — see the approved plan's decision #5).
 */
export async function insertServiceEntryDraftCore(
  supabase: SupabaseClient,
  userId: string,
  d: ReturnType<typeof serviceEntrySchema.parse>,
): Promise<{ data: { id: string } } | { error: string }> {
  const { data, error } = await supabase
    .from("service_entries")
    .insert({ ...d, created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  return { data };
}

export async function createServiceEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = serviceEntrySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const result = await insertServiceEntryDraftCore(supabase, userId, parsed.data);
  if ("error" in result) return { error: result.error };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export async function updateServiceEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسهٔ خدمت نامعتبر است." };
  const parsed = serviceEntrySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("service_entries").update(parsed.data).eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export type QuickAddServiceEntryInput = {
  client_service_file_id: string;
  service_category_id: string;
  title: string;
  service_date: string;
  performed_by: string;
  /** Optional for the Assistant path (a user may describe a service with no time yet); the web Quick Add form always provides it. */
  duration_minutes?: number;
  currency: ServiceLedgerCurrency;
  expense_amount?: number;
  expense_description?: string;
};

/**
 * The combined "quick log" write path (spec item #10 / §41's own worked
 * example: one voice message describing a service + time + expense
 * together should become ONE confirmation, not three) — a service
 * entry, its first time entry, and an optional expense, in one call.
 * Shared by the web Quick Add form (quickAddServiceEntry below) AND NIL
 * Assistant's CREATE_SERVICE_ENTRY_DRAFT action
 * (lib/assistant/actions/serviceLedger.ts) — one insert path, not two.
 *
 * Deliberately three sequential inserts, not one DB transaction: if the
 * time entry or expense insert fails after the service entry itself
 * succeeded, the entry is simply left behind as a recoverable row the
 * user can add the missing piece to from the Advanced Details view —
 * same "no special rollback case" philosophy already used by
 * createAndRegisterIncomingCore (app/actions/correspondence.ts).
 */
export async function quickAddServiceEntryCore(
  supabase: SupabaseClient,
  userId: string,
  d: QuickAddServiceEntryInput,
): Promise<{ data: { id: string } } | { error: string }> {
  const entryResult = await insertServiceEntryDraftCore(supabase, userId, {
    client_service_file_id: d.client_service_file_id,
    service_arrangement_id: undefined,
    contract_id: undefined,
    project_id: undefined,
    task_id: undefined,
    crm_activity_id: undefined,
    service_date: d.service_date,
    service_category_id: d.service_category_id,
    title: d.title,
    description: undefined,
    performed_by: d.performed_by,
    status: "IN_PROGRESS",
    billing_status: "NON_BILLABLE",
    billing_method: undefined,
    currency: d.currency,
    service_fee: 0,
    is_billable: true,
    notes: undefined,
  });
  if ("error" in entryResult) return entryResult;

  if (d.duration_minutes && d.duration_minutes > 0) {
    const timeResult = await addTimeEntryDraftCore(supabase, userId, {
      service_entry_id: entryResult.data.id,
      performed_by: d.performed_by,
      work_date: d.service_date,
      duration_minutes: d.duration_minutes,
      description: undefined,
      billable: true,
      hourly_rate_snapshot: undefined,
    });
    if ("error" in timeResult) return timeResult;
  }

  if (d.expense_amount && d.expense_amount > 0) {
    await addServiceExpenseDraftCore(supabase, userId, {
      service_entry_id: entryResult.data.id,
      expense_date: d.service_date,
      category_id: undefined,
      description: d.expense_description || "هزینهٔ ثبت‌شده از طریق ثبت سریع",
      amount: d.expense_amount,
      currency: d.currency,
      paid_by: "NIL",
      payment_id: undefined,
      accounting_reference: undefined,
      is_reimbursable: false,
      reimbursable_amount: undefined,
      billing_status: "NON_BILLABLE",
    });
  }

  return entryResult;
}

export async function quickAddServiceEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = quickAddServiceEntrySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const result = await quickAddServiceEntryCore(supabase, userId, { ...parsed.data, performed_by: userId });
  if ("error" in result) return { error: result.error };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export async function deleteServiceEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسهٔ خدمت نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("service_entries").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

/**
 * Bulk BILLABLE -> READY_TO_BILL (Phase 2 spec §35: "Mark Ready To Bill
 * ... for چند Item"). A thin wrapper — RLS + tg_service_entry_billing_status_guard
 * (0088) do the real gating (require can_approve_service_entry(), among
 * other adjacency rules), this action just turns a checked id list into
 * one `.in()` update.
 */
export async function bulkMarkServiceEntriesReadyToBill(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  let ids: string[];
  try {
    ids = JSON.parse(String(f.get("ids") ?? "[]"));
  } catch {
    return { error: "شناسه‌های نامعتبر." };
  }
  if (!Array.isArray(ids) || ids.length === 0) return { error: "هیچ خدمتی انتخاب نشده است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("service_entries").update({ billing_status: "READY_TO_BILL" }).in("id", ids);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

/** BILLABLE/READY_TO_BILL -> WAIVED with a required reason — mirrors void_cheque's "reason + actor + timestamp, row is self-documenting" shape. The generic tg_audit trigger (already wired) captures this as an audited change automatically. */
export async function waiveServiceEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = waiveServiceEntrySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("service_entries")
    .update({ billing_status: "WAIVED", waived_reason: parsed.data.reason, waived_by: userId, waived_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

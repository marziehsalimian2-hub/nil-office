"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  billingBatchSchema,
  billingBatchCandidateRefSchema,
  manualAdjustmentItemSchema,
} from "@/lib/validation-service-ledger";
import { z } from "zod";

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

export async function createBillingBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = billingBatchSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("billing_batches")
    .insert({ ...parsed.data, created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  redirect(`/service-ledger/billing-batches/${data.id}`);
}

/**
 * Maps a mixed list of candidate refs (SERVICE_ENTRY/TIME_ENTRY/EXPENSE)
 * into billing_batch_items rows — GRANULAR, never a full claimable-amount
 * rollup (see the Phase 2 plan's decision #1: a service_entries row can
 * contribute at most one SERVICE_ENTRY line (its own service_fee) and at
 * most one TIME_ENTRY line (its aggregated billable time), so its own
 * expenses — if ALSO selected as their own EXPENSE line — are never
 * double-counted). The DOUBLE_BILLING/CURRENCY_MISMATCH/BATCH_NOT_EDITABLE
 * errors are enforced by tg_billing_batch_item_guard (0089) — this action
 * surfaces whichever one fires via persianError rather than pre-checking.
 */
const addBillingBatchItemsInput = z.object({
  batch_id: z.string().uuid(),
  refs: z.array(billingBatchCandidateRefSchema).min(1, "هیچ ردیفی انتخاب نشده است."),
});

export async function addBillingBatchItems(_p: ActionState, f: FormData): Promise<ActionState> {
  let raw: unknown;
  try {
    raw = { batch_id: f.get("batch_id"), refs: JSON.parse(String(f.get("refs") ?? "[]")) };
  } catch {
    return { error: "ورودی نامعتبر است." };
  }
  const parsed = addBillingBatchItemsInput.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();

  const { data: batch, error: batchErr } = await supabase.from("billing_batches").select("id, currency").eq("id", parsed.data.batch_id).single();
  if (batchErr || !batch) return { error: "دستهٔ صورتحساب یافت نشد." };

  const { data: existingItems } = await supabase.from("billing_batch_items").select("line_no").eq("batch_id", batch.id).order("line_no", { ascending: false }).limit(1);
  let nextLineNo = (existingItems?.[0]?.line_no ?? 0) + 1;

  const rows: { batch_id: string; source_type: string; source_id: string; description: string; amount: number; currency: string; line_no: number }[] = [];

  for (const ref of parsed.data.refs) {
    if (ref.source_type === "SERVICE_ENTRY") {
      const { data: se } = await supabase.from("service_entries").select("title, service_fee").eq("id", ref.source_id).single();
      if (!se) continue;
      rows.push({ batch_id: batch.id, source_type: "SERVICE_ENTRY", source_id: ref.source_id, description: `حق‌الزحمه: ${se.title}`, amount: se.service_fee, currency: batch.currency, line_no: nextLineNo++ });
    } else if (ref.source_type === "TIME_ENTRY") {
      const { data: se } = await supabase.from("service_entries").select("title").eq("id", ref.source_id).single();
      const { data: times } = await supabase.from("time_entries").select("duration_minutes, hourly_rate_snapshot, billable").eq("service_entry_id", ref.source_id);
      const amount = (times ?? []).reduce((sum, t) => (t.billable && t.hourly_rate_snapshot != null ? sum + (t.duration_minutes / 60) * t.hourly_rate_snapshot : sum), 0);
      if (!se || amount <= 0) continue;
      rows.push({ batch_id: batch.id, source_type: "TIME_ENTRY", source_id: ref.source_id, description: `زمان صرف‌شده: ${se.title}`, amount, currency: batch.currency, line_no: nextLineNo++ });
    } else if (ref.source_type === "EXPENSE") {
      const { data: exp } = await supabase.from("expenses").select("description, amount, reimbursable_amount").eq("id", ref.source_id).single();
      if (!exp) continue;
      rows.push({ batch_id: batch.id, source_type: "EXPENSE", source_id: ref.source_id, description: exp.description, amount: exp.reimbursable_amount ?? exp.amount, currency: batch.currency, line_no: nextLineNo++ });
    }
  }
  if (rows.length === 0) return { error: "هیچ ردیف معتبری برای افزودن پیدا نشد." };

  const { error } = await supabase.from("billing_batch_items").insert(rows);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/service-ledger/billing-batches/${batch.id}`);
  return null;
}

export async function addManualAdjustmentItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = manualAdjustmentItemSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();

  const { data: batch, error: batchErr } = await supabase.from("billing_batches").select("id, currency").eq("id", parsed.data.batch_id).single();
  if (batchErr || !batch) return { error: "دستهٔ صورتحساب یافت نشد." };

  const { data: existingItems } = await supabase.from("billing_batch_items").select("line_no").eq("batch_id", batch.id).order("line_no", { ascending: false }).limit(1);
  const nextLineNo = (existingItems?.[0]?.line_no ?? 0) + 1;

  const { error } = await supabase.from("billing_batch_items").insert({
    batch_id: batch.id,
    source_type: "MANUAL_ADJUSTMENT",
    source_id: null,
    description: parsed.data.description,
    amount: parsed.data.amount,
    currency: batch.currency,
    line_no: nextLineNo,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/service-ledger/billing-batches/${batch.id}`);
  return null;
}

export async function removeBillingBatchItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const batchId = String(f.get("batch_id") ?? "");
  if (!id) return { error: "شناسهٔ ردیف نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("billing_batch_items").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (batchId) revalidatePath(`/service-ledger/billing-batches/${batchId}`);
  return null;
}

async function setBatchStatus(batchId: string, status: "DRAFT" | "READY" | "CANCELLED"): Promise<ActionState> {
  const { supabase } = await ctx();
  const { error } = await supabase.from("billing_batches").update({ status }).eq("id", batchId);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/service-ledger/billing-batches/${batchId}`);
  revalidatePath("/service-ledger/billing-batches");
  return null;
}

export async function markBillingBatchReady(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  return setBatchStatus(batchId, "READY");
}

export async function reopenBillingBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  return setBatchStatus(batchId, "DRAFT");
}

export async function cancelBillingBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  return setBatchStatus(batchId, "CANCELLED");
}

/** Calls convert_billing_batch_to_sales_document (0089) — the ONE bridge into the existing invoice engine — then redirects to the new document's own normal review/issue page, exactly like convertProformaToInvoice (app/actions/invoices.ts). */
export async function convertBillingBatch(_p: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batch_id") ?? "");
  const type = String(f.get("type") ?? "INVOICE");
  if (!batchId) return { error: "شناسهٔ دسته نامعتبر است." };
  if (type !== "PROFORMA" && type !== "INVOICE") return { error: "نوع سند نامعتبر است." };
  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("convert_billing_batch_to_sales_document", { p_batch_id: batchId, p_type: type });
  if (error) return { error: persianError(error.message) };
  redirect(`/invoices/${data.id}`);
}

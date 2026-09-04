"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { opportunitySchema, closeLostSchema } from "@/lib/validation-crm";

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

function opportunityPayload(d: ReturnType<typeof opportunitySchema.parse>) {
  return {
    title: d.title,
    company_id: d.company_id,
    primary_contact_id: d.primary_contact_id ?? null,
    case_id: d.case_id ?? null,
    opportunity_type: d.opportunity_type,
    pipeline_id: d.pipeline_id,
    stage_id: d.stage_id,
    owner_user_id: d.owner_user_id ?? null,
    currency_code: d.currency_code,
    estimated_value: d.estimated_value ?? null,
    probability: d.probability ?? null,
    expected_close_date: d.expected_close_date ?? null,
    source: d.source ?? null,
    priority: d.priority,
    description: d.description ?? null,
    internal_notes: d.internal_notes ?? null,
    next_action: d.next_action ?? null,
    next_action_date: d.next_action_date ?? null,
  };
}

/** Create an opportunity — numbered immediately by tg_crm_opportunity_number (0043), no draft state. */
export async function createOpportunity(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = opportunitySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("crm_opportunities")
    .insert({ ...opportunityPayload(parsed.data), created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  revalidatePath("/opportunities");
  revalidatePath(`/companies/${parsed.data.company_id}`);
  redirect(`/opportunities/${data.id}`);
}

/** Update an opportunity's editable fields — blocked once Won/Lost. */
export async function updateOpportunity(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه فرصت نامعتبر است." };
  const parsed = opportunitySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase } = await ctx();
  const { data: current } = await supabase
    .from("crm_opportunities")
    .select("won_at, lost_at")
    .eq("id", id)
    .single();
  if (!current) return { error: "فرصت یافت نشد." };
  if (current.won_at || current.lost_at) return { error: persianError("ALREADY_CLOSED") };

  const { error } = await supabase
    .from("crm_opportunities")
    .update(opportunityPayload(parsed.data))
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/opportunities");
  return null;
}

/** Ordinary pipeline progress — rejects a direct move onto the WON/LOST stage. */
export async function moveOpportunityStage(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const stageId = String(f.get("stage_id") ?? "");
  if (!id || !stageId) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("move_opportunity_stage", { p_id: id, p_stage_id: stageId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/opportunities");
  revalidatePath("/opportunities/board");
  return null;
}

export async function closeOpportunityWon(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه فرصت نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("close_opportunity_won", { p_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/opportunities");
  return null;
}

export async function closeOpportunityLost(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه فرصت نامعتبر است." };
  const parsed = closeLostSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("close_opportunity_lost", {
    p_id: id,
    p_lost_reason: parsed.data.lost_reason,
    p_lost_reason_note: parsed.data.lost_reason_note ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/opportunities");
  return null;
}

/** Create a DRAFT contract pre-filled from a won/active opportunity ("ایجاد قرارداد"). */
export async function createContractFromOpportunity(_p: ActionState, f: FormData): Promise<ActionState> {
  const opportunityId = String(f.get("opportunity_id") ?? "");
  if (!opportunityId) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();

  const { data: opp } = await supabase
    .from("crm_opportunities")
    .select("title, description, company_id, case_id, currency_code, estimated_value")
    .eq("id", opportunityId)
    .single();
  if (!opp) return { error: "فرصت یافت نشد." };

  const { data: contractType } = await supabase
    .from("contract_types")
    .select("id")
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .single();
  if (!contractType) return { error: "ابتدا باید حداقل یک نوع قرارداد تعریف شود." };

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      title: opp.title,
      contract_type_id: contractType.id,
      kind: "NIL_ISSUED",
      counterparty_company_id: opp.company_id,
      case_id: opp.case_id ?? null,
      opportunity_id: opportunityId,
      base_amount: opp.estimated_value ?? null,
      currency_code: opp.currency_code,
      description: opp.description ?? null,
      status: "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/opportunities/${opportunityId}`);
  redirect(`/contracts/${data.id}`);
}

/** Link an already-existing contract to this opportunity ("اتصال قرارداد موجود"). */
export async function linkExistingContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const opportunityId = String(f.get("opportunity_id") ?? "");
  const contractId = String(f.get("contract_id") ?? "");
  if (!opportunityId || !contractId) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("contracts").update({ opportunity_id: opportunityId }).eq("id", contractId);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${opportunityId}`);
  return null;
}

/** Create a DRAFT proforma pre-filled from an opportunity ("صدور پیش‌فاکتور"). */
export async function createProformaFromOpportunity(_p: ActionState, f: FormData): Promise<ActionState> {
  const opportunityId = String(f.get("opportunity_id") ?? "");
  if (!opportunityId) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();

  const { data: opp } = await supabase
    .from("crm_opportunities")
    .select("title, description, company_id, case_id, contract_id, currency_code, estimated_value")
    .eq("id", opportunityId)
    .single();
  if (!opp) return { error: "فرصت یافت نشد." };

  const { data: company } = await supabase
    .from("companies")
    .select("legal_name, english_name, contact_person, email, phone, address")
    .eq("id", opp.company_id)
    .single();
  if (!company) return { error: "شرکت مرتبط با این فرصت یافت نشد." };

  const { data: doc, error } = await supabase
    .from("sales_documents")
    .insert({
      type: "PROFORMA",
      status: "DRAFT",
      company_id: opp.company_id,
      contract_id: opp.contract_id ?? null,
      case_id: opp.case_id ?? null,
      opportunity_id: opportunityId,
      currency_code: opp.currency_code,
      notes: `مرتبط با فرصت تجاری: ${opp.title}`,
      customer_legal_name_snapshot: company.legal_name,
      customer_english_name_snapshot: company.english_name ?? null,
      customer_address_snapshot: company.address ?? null,
      customer_contact_person_snapshot: company.contact_person ?? null,
      customer_email_snapshot: company.email ?? null,
      customer_phone_snapshot: company.phone ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  const { error: itemErr } = await supabase.from("sales_document_items").insert({
    sales_document_id: doc.id,
    line_no: 1,
    item_type: "SERVICE",
    description: opp.description || opp.title,
    quantity: 1,
    unit_price: opp.estimated_value ?? 0,
  });
  if (itemErr) {
    await supabase.from("sales_documents").delete().eq("id", doc.id);
    return { error: persianError(itemErr.message) };
  }

  revalidatePath(`/opportunities/${opportunityId}`);
  redirect(`/invoices/${doc.id}`);
}

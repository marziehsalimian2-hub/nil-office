"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { amountToPersianWords } from "@/lib/cheque/amountToWords";
import type { ChequeDirection } from "@/lib/types/database";

export type ActionState = { error?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

const str = (v: FormDataEntryValue | null) => (v ? String(v) : null);
const uuidOrNull = (v: FormDataEntryValue | null) => (v && String(v).length > 0 ? String(v) : null);

/** Shape shared by the web form and NIL Assistant's CREATE_CHEQUE_DRAFT write-proposal executor. */
export type ChequeDraftInput = {
  direction: ChequeDirection;
  amount: number;
  currency_code: string;
  cheque_date: string;
  cheque_number: string;
  cheque_book_id?: string | null;
  sayad_id?: string | null;
  counterparty_company_id?: string | null;
  counterparty_name?: string | null;
  drawer_bank_name?: string | null;
  drawer_branch?: string | null;
  drawer_account_number?: string | null;
  purpose?: string | null;
  description?: string | null;
  company_id?: string | null;
  contract_id?: string | null;
  sales_document_id?: string | null;
  case_id?: string | null;
  project_id?: string | null;
};

/**
 * Non-redirecting core shared by the form action below and NIL
 * Assistant's CREATE_CHEQUE_DRAFT action (lib/assistant/actions/cheque.ts)
 * — one insert path for the web UI and the Assistant, mirroring
 * insertTaskDraftCore (app/actions/tasks.ts). amount_in_words is computed
 * here, once, via lib/cheque/amountToWords.ts — never left to the client
 * or duplicated in SQL.
 */
export async function createChequeDraftCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  _userId: string,
  d: ChequeDraftInput,
): Promise<{ data: { id: string } } | { error: string }> {
  if (!d.cheque_date) return { error: "تاریخ چک را به‌درستی وارد کنید." };

  let amountInWords: string;
  try {
    amountInWords = amountToPersianWords(Math.round(d.amount), d.currency_code);
  } catch {
    return { error: "مبلغ واردشده نامعتبر است." };
  }

  const { data, error } = await supabase.rpc("create_cheque_draft", {
    p_direction: d.direction,
    p_amount: d.amount,
    p_currency_code: d.currency_code,
    p_amount_in_words: amountInWords,
    p_cheque_date: d.cheque_date,
    p_cheque_number: d.cheque_number,
    p_cheque_book_id: d.cheque_book_id ?? null,
    p_sayad_id: d.sayad_id ?? null,
    p_counterparty_company_id: d.counterparty_company_id ?? null,
    p_counterparty_name: d.counterparty_name ?? null,
    p_drawer_bank_name: d.drawer_bank_name ?? null,
    p_drawer_branch: d.drawer_branch ?? null,
    p_drawer_account_number: d.drawer_account_number ?? null,
    p_purpose: d.purpose ?? null,
    p_description: d.description ?? null,
    p_company_id: d.company_id ?? null,
    p_contract_id: d.contract_id ?? null,
    p_sales_document_id: d.sales_document_id ?? null,
    p_case_id: d.case_id ?? null,
    p_project_id: d.project_id ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/cheques");
  return { data: { id: data.id } };
}

function chequeDraftInputFromForm(f: FormData): ChequeDraftInput {
  return {
    direction: String(f.get("direction")) as ChequeDirection,
    amount: Number(f.get("amount")),
    currency_code: String(f.get("currency_code") ?? "IRR"),
    cheque_date: String(f.get("cheque_date")),
    cheque_number: String(f.get("cheque_number")),
    cheque_book_id: uuidOrNull(f.get("cheque_book_id")),
    sayad_id: str(f.get("sayad_id")),
    counterparty_company_id: uuidOrNull(f.get("counterparty_company_id")),
    counterparty_name: str(f.get("counterparty_name")),
    drawer_bank_name: str(f.get("drawer_bank_name")),
    drawer_branch: str(f.get("drawer_branch")),
    drawer_account_number: str(f.get("drawer_account_number")),
    purpose: str(f.get("purpose")),
    description: str(f.get("description")),
    company_id: uuidOrNull(f.get("company_id")),
    contract_id: uuidOrNull(f.get("contract_id")),
    sales_document_id: uuidOrNull(f.get("sales_document_id")),
    case_id: uuidOrNull(f.get("case_id")),
    project_id: uuidOrNull(f.get("project_id")),
  };
}

export async function createChequeDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const { supabase, userId } = await ctx();
  const result = await createChequeDraftCore(supabase, userId, chequeDraftInputFromForm(f));
  if ("error" in result) return { error: result.error };
  redirect(`/cheques/${result.data.id}`);
}

export async function updateChequeDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ چک نامعتبر است." };
  const { supabase } = await ctx();

  const amount = f.get("amount") ? Number(f.get("amount")) : null;
  const currencyCode = str(f.get("currency_code"));
  let amountInWords: string | null = null;
  if (amount && currencyCode) {
    try {
      amountInWords = amountToPersianWords(Math.round(amount), currencyCode);
    } catch {
      return { error: "مبلغ واردشده نامعتبر است." };
    }
  }

  const { error } = await supabase.rpc("update_cheque_draft", {
    p_id: id,
    p_cheque_number: str(f.get("cheque_number")),
    p_sayad_id: str(f.get("sayad_id")),
    p_counterparty_company_id: uuidOrNull(f.get("counterparty_company_id")),
    p_counterparty_name: str(f.get("counterparty_name")),
    p_drawer_bank_name: str(f.get("drawer_bank_name")),
    p_drawer_branch: str(f.get("drawer_branch")),
    p_drawer_account_number: str(f.get("drawer_account_number")),
    p_amount: amount,
    p_currency_code: currencyCode,
    p_amount_in_words: amountInWords,
    p_cheque_date: str(f.get("cheque_date")),
    p_purpose: str(f.get("purpose")),
    p_description: str(f.get("description")),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/${id}`);
  revalidatePath("/cheques");
  return null;
}

/**
 * Non-redirecting core for NIL Assistant's PREPARE_CHEQUE_PRINT write
 * proposal (lib/assistant/actions/cheque.ts) — stages a PAYABLE cheque
 * DRAFT->PREPARED only. Never calls record_cheque_print itself: actual
 * printing stays a controlled, in-app-only action (spec §41/§43).
 */
export async function prepareChequeCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  _userId: string,
  payload: { cheque_id: string },
): Promise<{ data: { id: string } } | { error: string }> {
  const { data, error } = await supabase.rpc("prepare_cheque", { p_id: payload.cheque_id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/${payload.cheque_id}`);
  return { data: { id: data.id } };
}

/** Shared shape for every simple status-transition form action below. */
async function callTransitionRpc(fn: string, params: Record<string, unknown>, chequeId: string): Promise<ActionState> {
  const { supabase } = await ctx();
  const { error } = await supabase.rpc(fn, params);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/${chequeId}`);
  revalidatePath("/cheques");
  return null;
}

export async function prepareCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  return callTransitionRpc("prepare_cheque", { p_id: id }, id);
}
export async function issueCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  return callTransitionRpc("issue_cheque", { p_id: id }, id);
}
export async function deliverCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  return callTransitionRpc("deliver_cheque", { p_id: id }, id);
}
export async function receiveCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  return callTransitionRpc("receive_cheque", { p_id: id }, id);
}
export async function depositCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  return callTransitionRpc("deposit_cheque", { p_id: id }, id);
}
export async function clearCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  return callTransitionRpc("clear_cheque", { p_id: id }, id);
}
export async function markChequeReturned(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const reason = String(f.get("reason") ?? "");
  if (!reason.trim()) return { error: "درج دلیل برگشت الزامی است." };
  return callTransitionRpc("mark_cheque_returned", { p_id: id, p_reason: reason }, id);
}
export async function voidCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const reason = String(f.get("reason") ?? "");
  if (!reason.trim()) return { error: "درج دلیل ابطال الزامی است." };
  return callTransitionRpc("void_cheque", { p_id: id, p_reason: reason }, id);
}
export async function cancelCheque(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const reason = str(f.get("reason"));
  return callTransitionRpc("cancel_cheque", { p_id: id, p_reason: reason }, id);
}

/** Real print (increments print_count, reprint-of-ISSUED+ requires can_approve_cheque server-side) or a test print (touches nothing but the audit log). */
export async function recordChequePrint(chequeId: string, isTestPrint: boolean, templateId: string | null): Promise<ActionState> {
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("record_cheque_print", {
    p_id: chequeId,
    p_is_test_print: isTestPrint,
    p_template_id: templateId,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/${chequeId}`);
  return null;
}

/* ------------------------- Cheque Books ------------------------- */

export async function createChequeBook(_p: ActionState, f: FormData): Promise<ActionState> {
  const issueDate = str(f.get("issue_date"));
  if (!issueDate) return { error: "تاریخ صدور را به‌درستی وارد کنید." };

  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("create_cheque_book", {
    p_bank_account_id: String(f.get("bank_account_id") ?? ""),
    p_book_identifier: String(f.get("book_identifier") ?? ""),
    p_first_cheque_number: String(f.get("first_cheque_number") ?? ""),
    p_last_cheque_number: String(f.get("last_cheque_number") ?? ""),
    p_leaves_count: Number(f.get("leaves_count")),
    p_issue_date: issueDate,
    p_description: str(f.get("description")),
  });
  if (error) return { error: persianError(error.message) };
  redirect(`/cheques/books/${data.id}`);
}

export async function setChequeBookStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("set_cheque_book_status", { p_id: id, p_status: status });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/books/${id}`);
  revalidatePath("/cheques/books");
  return null;
}

/* ------------------------- Print Templates ------------------------- */

export async function createChequePrintTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("cheque_print_templates")
    .insert({
      name: String(f.get("name") ?? ""),
      bank_account_id: uuidOrNull(f.get("bank_account_id")),
      page_width_mm: Number(f.get("page_width_mm")),
      page_height_mm: Number(f.get("page_height_mm")),
      orientation: String(f.get("orientation") ?? "LANDSCAPE"),
      print_date_format: String(f.get("print_date_format") ?? "JALALI"),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  redirect(`/cheques/templates/${data.id}`);
}

export async function updateChequeGlobalOffset(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("cheque_print_templates")
    .update({ offset_x_mm: Number(f.get("offset_x_mm")), offset_y_mm: Number(f.get("offset_y_mm")) })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/templates/${id}`);
  return null;
}

export async function updateChequePrintTemplateField(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const templateId = String(f.get("template_id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("cheque_print_template_fields")
    .update({
      x_mm: Number(f.get("x_mm")),
      y_mm: Number(f.get("y_mm")),
      width_mm: Number(f.get("width_mm")),
      height_mm: Number(f.get("height_mm")),
      font_size_pt: Number(f.get("font_size_pt")),
      alignment: String(f.get("alignment") ?? "RIGHT"),
      direction: String(f.get("direction") ?? "RTL"),
      rotation_deg: Number(f.get("rotation_deg") ?? 0),
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/templates/${templateId}`);
  return null;
}

export async function createChequePrintTemplateField(_p: ActionState, f: FormData): Promise<ActionState> {
  const templateId = String(f.get("template_id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.from("cheque_print_template_fields").insert({
    template_id: templateId,
    field_key: String(f.get("field_key") ?? ""),
    custom_label: str(f.get("custom_label")),
    x_mm: Number(f.get("x_mm")),
    y_mm: Number(f.get("y_mm")),
    width_mm: Number(f.get("width_mm")),
    height_mm: Number(f.get("height_mm")),
    font_size_pt: Number(f.get("font_size_pt") ?? 10),
    alignment: String(f.get("alignment") ?? "RIGHT"),
    direction: String(f.get("direction") ?? "RTL"),
    rotation_deg: Number(f.get("rotation_deg") ?? 0),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/cheques/templates/${templateId}`);
  return null;
}

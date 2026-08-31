"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  fiscalYearSchema,
  accountSchema,
  detailAccountSchema,
  bankAccountSchema,
  journalHeaderSchema,
  journalLineSchema,
  cashDocSchema,
  accountingRoleSchema,
} from "@/lib/validation-accounting";

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

/* ------------------------------- fiscal years --------------------------- */
export async function createFiscalYear(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = fiscalYearSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("fiscal_years").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/fiscal-years");
  redirect("/accounting/fiscal-years");
}

export async function closeFiscalYear(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const force = String(f.get("force") ?? "") === "true";
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("close_fiscal_year", { p_fiscal_year_id: id, p_force: force });
  if (error) {
    console.error("closeFiscalYear: RPC failed", error);
    return { error: persianError(error.message) };
  }
  revalidatePath("/accounting/fiscal-years");
  return null;
}

/* ------------------------------- accounts ------------------------------- */
export async function createAccount(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = accountSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("accounts").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/accounts");
  redirect("/accounting/accounts");
}

export async function createDetailAccount(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = detailAccountSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("detail_accounts").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/accounts");
  redirect("/accounting/accounts");
}

/* ------------------------------- bank accounts -------------------------- */
export async function createBankAccount(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = bankAccountSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("bank_accounts").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/banks");
  redirect("/accounting/banks");
}

/* ------------------------------- journal entries ------------------------ */
export async function createJournalEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const header = journalHeaderSchema.safeParse(entries(f));
  if (!header.success) return { error: header.error.issues[0]?.message };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(String(f.get("lines") ?? "[]"));
  } catch {
    return { error: "ردیف‌های سند نامعتبر است." };
  }
  if (!Array.isArray(rawLines) || rawLines.length < 2)
    return { error: "سند باید حداقل دو ردیف داشته باشد." };

  const lines = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of rawLines) {
    const p = journalLineSchema.safeParse(r);
    if (!p.success) return { error: p.error.issues[0]?.message };
    lines.push(p.data);
    totalDebit += p.data.debit;
    totalCredit += p.data.credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 1e-6 || totalDebit === 0)
    return { error: "سند تراز نیست؛ جمع بدهکار و بستانکار باید برابر باشد." };

  const { supabase, userId } = await ctx();
  const { data: entry, error } = await supabase
    .from("journal_entries")
    .insert({ ...header.data, status: "DRAFT", created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  const lineRows = lines.map((l, i) => ({
    journal_entry_id: entry.id,
    account_id: l.account_id,
    detail_account_id: l.detail_account_id ?? null,
    description: l.description ?? null,
    debit: l.debit,
    credit: l.credit,
    company_id: l.company_id ?? null,
    case_id: l.case_id ?? null,
    line_no: i + 1,
  }));
  const { error: lineErr } = await supabase.from("journal_entry_lines").insert(lineRows);
  if (lineErr) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    return { error: persianError(lineErr.message) };
  }

  revalidatePath("/accounting/journal");
  redirect(`/accounting/journal/${entry.id}`);
}

/** Replace a journal entry's header + lines — only while still DRAFT. */
export async function updateJournalEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه سند نامعتبر است." };

  const header = journalHeaderSchema.safeParse(entries(f));
  if (!header.success) return { error: header.error.issues[0]?.message };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(String(f.get("lines") ?? "[]"));
  } catch {
    return { error: "ردیف‌های سند نامعتبر است." };
  }
  if (!Array.isArray(rawLines) || rawLines.length < 2)
    return { error: "سند باید حداقل دو ردیف داشته باشد." };

  const lines = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of rawLines) {
    const p = journalLineSchema.safeParse(r);
    if (!p.success) return { error: p.error.issues[0]?.message };
    lines.push(p.data);
    totalDebit += p.data.debit;
    totalCredit += p.data.credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 1e-6 || totalDebit === 0)
    return { error: "سند تراز نیست؛ جمع بدهکار و بستانکار باید برابر باشد." };

  const { supabase } = await ctx();
  const { data: current } = await supabase.from("journal_entries").select("status").eq("id", id).single();
  if (!current || current.status !== "DRAFT") return { error: "این سند دیگر قابل ویرایش نیست." };

  const { error } = await supabase.from("journal_entries").update(header.data).eq("id", id);
  if (error) return { error: persianError(error.message) };

  const { error: delErr } = await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", id);
  if (delErr) return { error: persianError(delErr.message) };

  const lineRows = lines.map((l, i) => ({
    journal_entry_id: id,
    account_id: l.account_id,
    detail_account_id: l.detail_account_id ?? null,
    description: l.description ?? null,
    debit: l.debit,
    credit: l.credit,
    company_id: l.company_id ?? null,
    case_id: l.case_id ?? null,
    line_no: i + 1,
  }));
  const { error: lineErr } = await supabase.from("journal_entry_lines").insert(lineRows);
  if (lineErr) return { error: persianError(lineErr.message) };

  revalidatePath(`/accounting/journal/${id}`);
  return null;
}

export async function postJournal(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("post_journal_entry", { p_entry_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/accounting/journal/${id}`);
  revalidatePath("/accounting/journal");
  return null;
}

export async function reverseJournal(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("reverse_journal_entry", { p_entry_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/journal");
  if (data) redirect(`/accounting/journal/${data}`);
  return null;
}

/* ------------------------------- receipts / payments -------------------- */
async function createCashDoc(table: "receipts" | "payments", f: FormData): Promise<ActionState> {
  const parsed = cashDocSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const d = parsed.data;
  const dateField = table === "receipts" ? "receipt_date" : "payment_date";
  const partyField = table === "receipts" ? "payer" : "payee";
  const row: Record<string, unknown> = {
    [dateField]: d.date,
    [partyField]: d.counterparty ?? null,
    amount: d.amount,
    currency_code: d.currency_code,
    bank_account_id: d.bank_account_id,
    counterpart_account_id: d.counterpart_account_id,
    detail_account_id: d.detail_account_id ?? null,
    method: d.method ?? null,
    reference: d.reference ?? null,
    description: d.description ?? null,
    company_id: d.company_id ?? null,
    case_id: d.case_id ?? null,
    fiscal_year_id: d.fiscal_year_id,
    status: "DRAFT",
    created_by: userId,
  };
  const { error } = await supabase.from(table).insert(row);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/accounting/${table}`);
  redirect(`/accounting/${table}`);
}

export async function createReceipt(_p: ActionState, f: FormData) {
  return createCashDoc("receipts", f);
}
export async function createPayment(_p: ActionState, f: FormData) {
  return createCashDoc("payments", f);
}

/** Update a receipt/payment's fields — only while still DRAFT. */
async function updateCashDoc(table: "receipts" | "payments", f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه سند نامعتبر است." };

  const parsed = cashDocSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase } = await ctx();
  const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
  if (!current || current.status !== "DRAFT") return { error: "این سند دیگر قابل ویرایش نیست." };

  const d = parsed.data;
  const dateField = table === "receipts" ? "receipt_date" : "payment_date";
  const partyField = table === "receipts" ? "payer" : "payee";
  const row: Record<string, unknown> = {
    [dateField]: d.date,
    [partyField]: d.counterparty ?? null,
    amount: d.amount,
    currency_code: d.currency_code,
    bank_account_id: d.bank_account_id,
    counterpart_account_id: d.counterpart_account_id,
    detail_account_id: d.detail_account_id ?? null,
    method: d.method ?? null,
    reference: d.reference ?? null,
    description: d.description ?? null,
    company_id: d.company_id ?? null,
    case_id: d.case_id ?? null,
    fiscal_year_id: d.fiscal_year_id,
  };
  const { error } = await supabase.from(table).update(row).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/accounting/${table}`);
  return null;
}

export async function updateReceipt(_p: ActionState, f: FormData) {
  return updateCashDoc("receipts", f);
}
export async function updatePayment(_p: ActionState, f: FormData) {
  return updateCashDoc("payments", f);
}

export async function postReceipt(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("post_receipt", { p_receipt_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/receipts");
  return null;
}
export async function postPayment(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("post_payment", { p_payment_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/payments");
  return null;
}

/* ------------------------------- settings ------------------------------- */
export async function setDisplayUnit(_p: ActionState, f: FormData): Promise<ActionState> {
  const unit = String(f.get("display_unit") ?? "");
  if (!["RIAL", "TOMAN"].includes(unit)) return { error: "واحد نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("app_settings")
    .update({ display_unit: unit, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  revalidatePath("/accounting");
  return null;
}

export async function setAccountingRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), accounting_role: f.get("accounting_role") || null };
  const parsed = accountingRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ accounting_role: parsed.data.accounting_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}

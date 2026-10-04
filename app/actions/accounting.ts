"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  CASH_LABEL, EVIDENCE_EXT_BY_MIME, parseAmountText, checkDraftDate, decideDuplicates, sha256Hex,
  type CashKind, type DuplicateReport,
} from "@/lib/assistant/cashDraft";
import {
  fiscalYearSchema,
  accountSchema,
  detailAccountSchema,
  bankAccountSchema,
  journalHeaderSchema,
  journalLineSchema,
  cashDocSchema,
  accountingRoleSchema,
  cashAllocationSchema,
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
    contract_id: d.contract_id ?? null,
    fiscal_year_id: d.fiscal_year_id,
    status: "DRAFT",
    created_by: userId,
  };
  const { data: inserted, error } = await supabase.from(table).insert(row).select("id").single();
  if (error) return { error: persianError(error.message) };

  const rawAllocations = String(f.get("allocations") ?? "[]");
  if (rawAllocations !== "[]") {
    const fd2 = new FormData();
    fd2.set("id", inserted.id);
    fd2.set("allocations", rawAllocations);
    const allocResult = await setAllocations(table, fd2);
    if (allocResult?.error) {
      await supabase.from(table).delete().eq("id", inserted.id);
      return allocResult;
    }
  }

  revalidatePath(`/accounting/${table}`);
  redirect(`/accounting/${table}`);
}

export async function createReceipt(_p: ActionState, f: FormData) {
  return createCashDoc("receipts", f);
}
export async function createPayment(_p: ActionState, f: FormData) {
  return createCashDoc("payments", f);
}

export type CashDraftPayload = {
  kind: CashKind;
  /** exact decimal STRING (parseAmountText) — never a float */
  amount: string;
  currency: string;
  /** ISO date */
  date: string;
  counterparty: string | null;
  company_id: string | null;
  contract_id: string | null;
  bank_account_id: string | null;
  fiscal_year_id: string | null;
  method: string | null;
  reference: string | null;
  description: string | null;
  confirmed_not_duplicate: boolean;
  evidence_base64: string | null;
  evidence_mime: string | null;
  evidence_sha256: string | null;
};

/**
 * Non-redirecting core shared by NIL Assistant's CREATE_RECEIPT_DRAFT / CREATE_PAYMENT_DRAFT (Slice 2).
 * It ONLY inserts a DRAFT row (+ archives the evidence file). It never calls verify_* / post_* / set_cash_allocations
 * and never touches a journal — the counterpart account stays null (a bookkeeping decision for the accountant) and the
 * accountant completes, verifies and posts through the existing web flow (docs/ACCOUNTING_AI_SAFETY.md).
 * Everything the proposal step checked is re-checked here: the payload is model-derived, the executor must not trust it.
 */
export async function createCashDraftCore(
  supabase: SupabaseClient,
  userId: string,
  d: CashDraftPayload,
): Promise<{ data: { id: string } } | { error: string }> {
  if (d.kind !== "RECEIPT" && d.kind !== "PAYMENT") return { error: "نوع سند نامعتبر است." };
  const amount = parseAmountText(d.amount);
  if (!amount.ok) return { error: amount.error };
  const dateCheck = checkDraftDate(d.date, new Date().toISOString().slice(0, 10));
  if (!dateCheck.ok) return { error: dateCheck.error };

  const { data: me } = await supabase.from("profiles").select("role, accounting_role, is_active").eq("id", userId).maybeSingle();
  if (!me?.is_active || !(me.role === "ADMIN" || ["CREATE", "POST", "ADMIN"].includes(me.accounting_role ?? ""))) {
    return { error: "برای ثبت پیش‌نویس دریافت/پرداخت سطح دسترسی «ایجاد» در حسابداری لازم است." };
  }

  // Duplicate control runs again at execute time (a second proposal may have been confirmed since). Fail CLOSED.
  const { data: dup, error: dupErr } = await supabase.rpc("assistant_cash_duplicates", {
    p_profile_id: userId, p_kind: d.kind, p_amount: amount.value, p_currency: d.currency,
    p_reference: d.reference, p_date: d.date, p_company: d.company_id, p_sha256: d.evidence_sha256,
  });
  if (dupErr || !dup) return { error: "بررسی تکراری‌بودن سند ناموفق بود؛ چیزی ثبت نشد." };
  const decision = decideDuplicates(dup as DuplicateReport, d.confirmed_not_duplicate === true);
  if (decision.block) return { error: "این سند به‌احتمال زیاد تکراری است؛ چیزی ثبت نشد." };

  let evidence: { buffer: Buffer; ext: string } | null = null;
  if (d.evidence_base64) {
    const ext = EVIDENCE_EXT_BY_MIME[d.evidence_mime ?? ""];
    if (!ext) return { error: "نوع فایل مدرک پشتیبانی نمی‌شود." };
    const buffer = Buffer.from(d.evidence_base64, "base64");
    if (!d.evidence_sha256 || sha256Hex(buffer) !== d.evidence_sha256) return { error: "یکپارچگی فایل مدرک تأیید نشد؛ چیزی ثبت نشد." };
    evidence = { buffer, ext };
  }

  const L = CASH_LABEL[d.kind];
  const dateField = d.kind === "RECEIPT" ? "receipt_date" : "payment_date";
  const partyField = d.kind === "RECEIPT" ? "payer" : "payee";
  const { data: inserted, error } = await supabase
    .from(L.table)
    .insert({
      [dateField]: d.date,
      [partyField]: d.counterparty,
      amount: amount.value,
      currency_code: d.currency,
      bank_account_id: d.bank_account_id,
      counterpart_account_id: null,
      fiscal_year_id: d.fiscal_year_id,
      method: d.method,
      reference: d.reference,
      description: d.description,
      company_id: d.company_id,
      contract_id: d.contract_id,
      status: "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: persianError(error?.message) };

  if (evidence) {
    const path = `cash-evidence/${d.kind.toLowerCase()}/${inserted.id}/${Date.now()}.${evidence.ext}`;
    const { error: upErr } = await supabase.storage.from("nil-files").upload(path, evidence.buffer, { contentType: d.evidence_mime ?? undefined, upsert: false });
    const { error: attErr } = upErr
      ? { error: upErr }
      : await supabase.from("attachments").insert({
          entity_type: d.kind,
          entity_id: inserted.id,
          file_name: `مدرک-${L.noun.replace("/", "-")}.${evidence.ext}`,
          storage_path: path,
          mime_type: d.evidence_mime,
          size_bytes: evidence.buffer.length,
          uploaded_by: userId,
          sha256: d.evidence_sha256,
        });
    if (attErr) {
      // The evidence is what makes the draft auditable and duplicate-checkable: no evidence archived -> no draft.
      console.error("createCashDraftCore: evidence archival failed", attErr);
      await supabase.from(L.table).delete().eq("id", inserted.id).eq("status", "DRAFT");
      return { error: "بایگانی فایل مدرک ناموفق بود؛ چیزی ثبت نشد. لطفاً دوباره تلاش کنید." };
    }
  }

  revalidatePath(`/accounting/${L.table}`);
  return { data: { id: inserted.id } };
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
    contract_id: d.contract_id ?? null,
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

/** Replaces a receipt/payment's full allocation set — only while still DRAFT (enforced by the RPC). */
async function setAllocations(table: "receipts" | "payments", f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه سند نامعتبر است." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(f.get("allocations") ?? "[]"));
  } catch {
    return { error: "تخصیص‌ها نامعتبر است." };
  }
  if (!Array.isArray(raw)) return { error: "تخصیص‌ها نامعتبر است." };

  const allocations = [];
  for (const a of raw) {
    const parsed = cashAllocationSchema.safeParse(a);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    allocations.push(parsed.data);
  }

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("set_cash_allocations", {
    p_source_kind: table === "receipts" ? "RECEIPT" : "PAYMENT",
    p_source_id: id,
    p_allocations: allocations,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/accounting/${table}`);
  return null;
}

export async function setReceiptAllocations(_p: ActionState, f: FormData) {
  return setAllocations("receipts", f);
}
export async function setPaymentAllocations(_p: ActionState, f: FormData) {
  return setAllocations("payments", f);
}

export async function verifyReceipt(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("verify_receipt", { p_receipt_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/receipts");
  return null;
}
export async function verifyPayment(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("verify_payment", { p_payment_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/accounting/payments");
  return null;
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

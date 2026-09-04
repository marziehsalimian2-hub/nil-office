"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { currentJalaliYear } from "@/lib/jalali";
import { salesDocumentSchema, salesDocumentItemSchema, invoiceRoleSchema } from "@/lib/validation-invoices";

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

/** Simple (non-numbering, non-conversion) status transitions a plain update may perform. */
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["DRAFT", "APPROVED"],
  ISSUED: ["ACCEPTED", "EXPIRED", "PARTIALLY_SETTLED", "SETTLED", "OVERDUE"],
  ACCEPTED: ["EXPIRED"],
  PARTIALLY_SETTLED: ["SETTLED", "OVERDUE"],
  OVERDUE: ["PARTIALLY_SETTLED", "SETTLED"],
};

function parseItems(raw: FormDataEntryValue | null): { error: string } | { items: ReturnType<typeof salesDocumentItemSchema.parse>[] } {
  let rawItems: unknown;
  try {
    rawItems = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { error: "ردیف‌های سند نامعتبر است." };
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: "سند باید حداقل یک ردیف داشته باشد." };
  }
  const items = [];
  for (const r of rawItems) {
    const p = salesDocumentItemSchema.safeParse(r);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "ردیف نامعتبر است." };
    items.push(p.data);
  }
  return { items };
}

/** Create a proforma/invoice as DRAFT — no number is issued until it is issued via RPC. */
export async function createSalesDocumentDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = salesDocumentSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const itemsResult = parseItems(f.get("items"));
  if ("error" in itemsResult) return { error: itemsResult.error };

  const { supabase, userId } = await ctx();
  const d = parsed.data;
  const { data, error } = await supabase
    .from("sales_documents")
    .insert({
      type: d.type,
      status: "DRAFT",
      company_id: d.company_id,
      contract_id: d.contract_id ?? null,
      case_id: d.case_id ?? null,
      issue_date: d.issue_date ?? null,
      due_date: d.due_date ?? null,
      validity_date: d.validity_date ?? null,
      currency_code: d.currency_code,
      payment_terms: d.payment_terms ?? null,
      notes: d.notes ?? null,
      customer_legal_name_snapshot: d.customer_legal_name_snapshot,
      customer_english_name_snapshot: d.customer_english_name_snapshot ?? null,
      customer_registration_number_snapshot: d.customer_registration_number_snapshot ?? null,
      customer_national_id_snapshot: d.customer_national_id_snapshot ?? null,
      customer_economic_code_snapshot: d.customer_economic_code_snapshot ?? null,
      customer_address_snapshot: d.customer_address_snapshot ?? null,
      customer_postal_code_snapshot: d.customer_postal_code_snapshot ?? null,
      customer_contact_person_snapshot: d.customer_contact_person_snapshot ?? null,
      customer_email_snapshot: d.customer_email_snapshot ?? null,
      customer_phone_snapshot: d.customer_phone_snapshot ?? null,
      signatory_id: d.signatory_id ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  const itemRows = itemsResult.items.map((it, i) => ({
    sales_document_id: data.id,
    line_no: i + 1,
    item_type: it.item_type,
    description: it.description,
    unit: it.unit ?? null,
    quantity: it.quantity,
    unit_price: it.unit_price,
    discount_amount: it.discount_amount,
    tax_amount: it.tax_amount,
  }));
  const { error: itemErr } = await supabase.from("sales_document_items").insert(itemRows);
  if (itemErr) {
    await supabase.from("sales_documents").delete().eq("id", data.id);
    return { error: persianError(itemErr.message) };
  }

  revalidatePath("/invoices");
  redirect(`/invoices/${data.id}`);
}

/** Replace a sales document's header + items — only while still DRAFT/REVIEW. */
export async function updateSalesDocumentDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه سند نامعتبر است." };

  const parsed = salesDocumentSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const itemsResult = parseItems(f.get("items"));
  if ("error" in itemsResult) return { error: itemsResult.error };

  const { supabase } = await ctx();
  const { data: current } = await supabase.from("sales_documents").select("status").eq("id", id).single();
  if (!current || !["DRAFT", "REVIEW"].includes(current.status)) {
    return { error: "این سند دیگر قابل ویرایش نیست." };
  }

  const d = parsed.data;
  const { error } = await supabase
    .from("sales_documents")
    .update({
      company_id: d.company_id,
      contract_id: d.contract_id ?? null,
      case_id: d.case_id ?? null,
      issue_date: d.issue_date ?? null,
      due_date: d.due_date ?? null,
      validity_date: d.validity_date ?? null,
      currency_code: d.currency_code,
      payment_terms: d.payment_terms ?? null,
      notes: d.notes ?? null,
      customer_legal_name_snapshot: d.customer_legal_name_snapshot,
      customer_english_name_snapshot: d.customer_english_name_snapshot ?? null,
      customer_registration_number_snapshot: d.customer_registration_number_snapshot ?? null,
      customer_national_id_snapshot: d.customer_national_id_snapshot ?? null,
      customer_economic_code_snapshot: d.customer_economic_code_snapshot ?? null,
      customer_address_snapshot: d.customer_address_snapshot ?? null,
      customer_postal_code_snapshot: d.customer_postal_code_snapshot ?? null,
      customer_contact_person_snapshot: d.customer_contact_person_snapshot ?? null,
      customer_email_snapshot: d.customer_email_snapshot ?? null,
      customer_phone_snapshot: d.customer_phone_snapshot ?? null,
      signatory_id: d.signatory_id ?? null,
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };

  const { error: delErr } = await supabase.from("sales_document_items").delete().eq("sales_document_id", id);
  if (delErr) return { error: persianError(delErr.message) };

  const itemRows = itemsResult.items.map((it, i) => ({
    sales_document_id: id,
    line_no: i + 1,
    item_type: it.item_type,
    description: it.description,
    unit: it.unit ?? null,
    quantity: it.quantity,
    unit_price: it.unit_price,
    discount_amount: it.discount_amount,
    tax_amount: it.tax_amount,
  }));
  const { error: itemErr } = await supabase.from("sales_document_items").insert(itemRows);
  if (itemErr) return { error: persianError(itemErr.message) };

  revalidatePath(`/invoices/${id}`);
  return null;
}

/** Advance a simple (non-numbering, non-conversion) status transition. */
export async function setSalesDocumentStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  const { supabase } = await ctx();

  const { data: current } = await supabase.from("sales_documents").select("status").eq("id", id).single();
  if (!current) return { error: "سند یافت نشد." };
  if (!(SIMPLE_TRANSITIONS[current.status] ?? []).includes(status)) {
    return { error: "تغییر وضعیت در این مرحله مجاز نیست." };
  }

  const { error } = await supabase.from("sales_documents").update({ status }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return null;
}

/** Atomically issue a proforma/invoice and assign its official PI-/INV- number. */
export async function issueSalesDocument(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("finalize_sales_document", {
    p_id: id,
    p_year: currentJalaliYear(),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return null;
}

/** Convert an issued/accepted proforma into a new, numberless DRAFT invoice. */
export async function convertProformaToInvoice(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("convert_proforma_to_invoice", { p_proforma_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  const newDoc = Array.isArray(data) ? data[0] : data;
  if (newDoc?.id) redirect(`/invoices/${newDoc.id}`);
  return null;
}

/** Cancel a sales document — keeps any assigned number. */
export async function cancelSalesDocument(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("cancel_sales_document", { p_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return null;
}

/** Create a DRAFT proforma/invoice pre-filled from a contract ("صدور پیش‌فاکتور"/"صدور فاکتور"). */
export async function createSalesDocumentFromContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const contractId = String(f.get("contract_id") ?? "");
  const docType = String(f.get("doc_type") ?? "");
  if (!contractId || (docType !== "PROFORMA" && docType !== "INVOICE")) {
    return { error: "ورودی نامعتبر است." };
  }
  const { supabase, userId } = await ctx();

  const { data: contract } = await supabase
    .from("contracts")
    .select("title, description, counterparty_company_id, case_id, currency_code, total_amount")
    .eq("id", contractId)
    .single();
  if (!contract) return { error: "قرارداد یافت نشد." };

  let company: { legal_name: string; english_name: string | null; contact_person: string | null; email: string | null; phone: string | null; address: string | null } | null = null;
  if (contract.counterparty_company_id) {
    const { data: co } = await supabase
      .from("companies")
      .select("legal_name, english_name, contact_person, email, phone, address")
      .eq("id", contract.counterparty_company_id)
      .single();
    company = co ?? null;
  }
  if (!company) return { error: "برای این قرارداد طرف قرارداد ثبت نشده است." };

  const { data: doc, error } = await supabase
    .from("sales_documents")
    .insert({
      type: docType,
      status: "DRAFT",
      company_id: contract.counterparty_company_id,
      contract_id: contractId,
      case_id: contract.case_id ?? null,
      currency_code: contract.currency_code,
      notes: `مرتبط با قرارداد: ${contract.title}`,
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
    description: contract.description || contract.title,
    quantity: 1,
    unit_price: contract.total_amount ?? 0,
  });
  if (itemErr) {
    await supabase.from("sales_documents").delete().eq("id", doc.id);
    return { error: persianError(itemErr.message) };
  }

  revalidatePath(`/contracts/${contractId}`);
  redirect(`/invoices/${doc.id}`);
}

/* ------------------------------- settings --------------------------------- */
export async function setInvoiceRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), invoice_role: f.get("invoice_role") || null };
  const parsed = invoiceRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ invoice_role: parsed.data.invoice_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}

import { createClient } from "@/lib/supabase/server";
import type { Account, DetailAccount, BankAccount, FiscalYear, Company, Case, Contract, SalesDocument } from "@/lib/types/database";

/** Option lists used by accounting forms (posting accounts, banks, fiscal years). */
export async function loadAccountingOptions() {
  const supabase = await createClient();
  const [postingAccounts, allAccounts, details, banks, fyears, companies, cases, contracts, salesDocuments] = await Promise.all([
    supabase.from("accounts").select("id, code, name, account_type").eq("allows_posting", true).eq("is_active", true).order("code"),
    supabase.from("accounts").select("id, code, name, level, allows_posting").order("code"),
    supabase.from("detail_accounts").select("id, name, code").eq("is_active", true).order("name"),
    supabase.from("bank_accounts").select("id, account_title, kind, account_id").eq("is_active", true).order("account_title"),
    supabase.from("fiscal_years").select("id, title, status").order("start_date", { ascending: false }),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("contracts").select("id, display_number, external_contract_number, title, total_amount").order("created_at", { ascending: false }),
    supabase.from("sales_documents").select("id, display_number, customer_legal_name_snapshot, total_amount").eq("type", "INVOICE").order("created_at", { ascending: false }),
  ]);
  return {
    postingAccounts: (postingAccounts.data ?? []) as Pick<Account, "id" | "code" | "name" | "account_type">[],
    allAccounts: (allAccounts.data ?? []) as Pick<Account, "id" | "code" | "name" | "level" | "allows_posting">[],
    details: (details.data ?? []) as Pick<DetailAccount, "id" | "name" | "code">[],
    banks: (banks.data ?? []) as Pick<BankAccount, "id" | "account_title" | "kind" | "account_id">[],
    fiscalYears: (fyears.data ?? []) as Pick<FiscalYear, "id" | "title" | "status">[],
    companies: (companies.data ?? []) as Pick<Company, "id" | "legal_name">[],
    cases: (cases.data ?? []) as Pick<Case, "id" | "case_code" | "title">[],
    contracts: (contracts.data ?? []) as Pick<Contract, "id" | "display_number" | "external_contract_number" | "title" | "total_amount">[],
    salesDocuments: (salesDocuments.data ?? []) as Pick<SalesDocument, "id" | "display_number" | "customer_legal_name_snapshot" | "total_amount">[],
  };
}

export async function getDisplayUnit(): Promise<"RIAL" | "TOMAN"> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("display_unit").eq("id", 1).single();
  return (data?.display_unit as "RIAL" | "TOMAN") ?? "RIAL";
}

export type CashEvidenceLink = { name: string; url: string };

/**
 * Evidence files (bank-receipt photos / supplier invoices archived by the Assistant) for a page of receipts or
 * payments, as short-lived signed URLs. Both lookups run under the CALLER's session: attachments of type
 * RECEIPT/PAYMENT and storage `cash-evidence/%` are accounting-only (0135), so a non-accounting user gets nothing.
 */
export async function loadCashEvidence(kind: "RECEIPT" | "PAYMENT", ids: string[]): Promise<Map<string, CashEvidenceLink[]>> {
  const out = new Map<string, CashEvidenceLink[]>();
  if (ids.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("attachments").select("entity_id, file_name, storage_path").eq("entity_type", kind).in("entity_id", ids);
  const rows = (data ?? []) as { entity_id: string; file_name: string; storage_path: string }[];
  if (rows.length === 0) return out;
  const { data: signed } = await supabase.storage.from("nil-files").createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl] as const));
  for (const r of rows) {
    const url = urlByPath.get(r.storage_path);
    if (!url) continue;
    const list = out.get(r.entity_id) ?? [];
    list.push({ name: r.file_name, url });
    out.set(r.entity_id, list);
  }
  return out;
}

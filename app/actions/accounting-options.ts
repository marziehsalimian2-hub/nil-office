import { createClient } from "@/lib/supabase/server";
import type { Account, DetailAccount, BankAccount, FiscalYear, Company, Case, Contract } from "@/lib/types/database";

/** Option lists used by accounting forms (posting accounts, banks, fiscal years). */
export async function loadAccountingOptions() {
  const supabase = await createClient();
  const [postingAccounts, allAccounts, details, banks, fyears, companies, cases, contracts] = await Promise.all([
    supabase.from("accounts").select("id, code, name, account_type").eq("allows_posting", true).eq("is_active", true).order("code"),
    supabase.from("accounts").select("id, code, name, level, allows_posting").order("code"),
    supabase.from("detail_accounts").select("id, name, code").eq("is_active", true).order("name"),
    supabase.from("bank_accounts").select("id, account_title, kind, account_id").eq("is_active", true).order("account_title"),
    supabase.from("fiscal_years").select("id, title, status").order("start_date", { ascending: false }),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("contracts").select("id, display_number, external_contract_number, title").order("created_at", { ascending: false }),
  ]);
  return {
    postingAccounts: (postingAccounts.data ?? []) as Pick<Account, "id" | "code" | "name" | "account_type">[],
    allAccounts: (allAccounts.data ?? []) as Pick<Account, "id" | "code" | "name" | "level" | "allows_posting">[],
    details: (details.data ?? []) as Pick<DetailAccount, "id" | "name" | "code">[],
    banks: (banks.data ?? []) as Pick<BankAccount, "id" | "account_title" | "kind" | "account_id">[],
    fiscalYears: (fyears.data ?? []) as Pick<FiscalYear, "id" | "title" | "status">[],
    companies: (companies.data ?? []) as Pick<Company, "id" | "legal_name">[],
    cases: (cases.data ?? []) as Pick<Case, "id" | "case_code" | "title">[],
    contracts: (contracts.data ?? []) as Pick<Contract, "id" | "display_number" | "external_contract_number" | "title">[],
  };
}

export async function getDisplayUnit(): Promise<"RIAL" | "TOMAN"> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("display_unit").eq("id", 1).single();
  return (data?.display_unit as "RIAL" | "TOMAN") ?? "RIAL";
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";
import type { CurrencyAmount } from "./types";

export type BankPosition = { id: string; label: string; currency_code: string; balance: number };
export type FinancialSummary = {
  bankPositions: BankPosition[];
  cashByCurrency: CurrencyAmount[];
  revenue: number;
  expense: number;
  netResult: number;
  fiscalYearTitle: string | null;
};

/**
 * Financial Executive Summary — authoritative-accounting only (spec
 * §9/§10). Hard-gated on accounting access: when the caller lacks it,
 * this function returns null WITHOUT ever issuing a query — the data is
 * never fetched, not merely hidden after the fact (spec §58's explicit
 * requirement, since hiding a card that already holds the number isn't
 * enough).
 *
 * Cash/Bank Position and Revenue/Expense/Net Result come from
 * v_trial_balance (0016, security_invoker, already RLS-respecting,
 * already nets REVERSED entries to zero) — the GL itself has no
 * per-account currency, only journal_entry_lines.currency_code as a memo
 * field, so these figures are genuinely single-currency by construction
 * and safe to display as one number each. Receivables (multi-currency,
 * invoice-level) lives in lib/dashboard/invoices.ts instead — see that
 * file's header comment for why.
 */
export async function getFinancialSummary(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "accounting_role">,
): Promise<FinancialSummary | null> {
  if (profile.role !== "ADMIN" && profile.accounting_role == null) return null;

  const [{ data: openFiscalYear }, { data: bankAccounts }, { data: trialBalance }] = await Promise.all([
    supabase.from("fiscal_years").select("id, title").eq("status", "OPEN").order("start_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("bank_accounts").select("id, account_title, bank_name, currency_code, account_id").eq("is_active", true),
    supabase.from("v_trial_balance").select("account_id, account_type, nature, balance, fiscal_year_id"),
  ]);

  type TbRow = { account_id: string; account_type: string; nature: string; balance: number; fiscal_year_id: string | null };
  const tbRows = (trialBalance ?? []) as TbRow[];
  const balanceByAccount = new Map<string, number>();
  for (const r of tbRows) balanceByAccount.set(r.account_id, (balanceByAccount.get(r.account_id) ?? 0) + Number(r.balance));

  const bankPositions: BankPosition[] = ((bankAccounts ?? []) as { id: string; account_title: string; bank_name: string | null; currency_code: string; account_id: string | null }[])
    .filter((b) => b.account_id)
    .map((b) => ({
      id: b.id,
      label: b.bank_name ? `${b.account_title} — ${b.bank_name}` : b.account_title,
      currency_code: b.currency_code,
      balance: balanceByAccount.get(b.account_id as string) ?? 0,
    }));

  const cashByCurrencyMap = new Map<string, number>();
  for (const b of bankPositions) cashByCurrencyMap.set(b.currency_code, (cashByCurrencyMap.get(b.currency_code) ?? 0) + b.balance);
  const cashByCurrency: CurrencyAmount[] = Array.from(cashByCurrencyMap, ([currency_code, amount]) => ({ currency_code, amount }));

  const fyId = openFiscalYear?.id ?? null;
  let revenue = 0;
  let expense = 0;
  for (const r of tbRows) {
    if (fyId && r.fiscal_year_id !== fyId) continue;
    const natural = r.nature === "CREDIT" ? -Number(r.balance) : Number(r.balance);
    if (r.account_type === "REVENUE") revenue += natural;
    if (r.account_type === "EXPENSE") expense += natural;
  }

  return {
    bankPositions,
    cashByCurrency,
    revenue,
    expense,
    netResult: revenue - expense,
    fiscalYearTitle: openFiscalYear?.title ?? null,
  };
}

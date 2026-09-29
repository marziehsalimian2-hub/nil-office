import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, ServiceLedgerPortfolioCountsRow, ServiceLedgerPortfolioMoneyRow } from "@/lib/types/database";
import type { CurrencyAmount } from "./types";

export type ServiceLedgerSummary = {
  activeClientsCount: number;
  servicesThisPeriodCount: number;
  hoursThisPeriodTotal: number;
  clientsRequiringBillingCount: number;
  unbilledByCurrency: CurrencyAmount[];
  reimbursableOutstandingByCurrency: CurrencyAmount[];
};

/**
 * Client Service Ledger Executive Summary — same hard-gate-before-query
 * shape every other dashboard section already uses
 * (lib/dashboard/{financial,invoices,crm,...}.ts). Aggregates the two
 * portfolio rollups (get_service_ledger_portfolio_counts/_money,
 * 0092_service_ledger_reporting.sql) in TS over an already-small
 * one-row-per-active-client result set — no N+1, no third SQL function
 * needed just to sum across clients.
 */
export async function getServiceLedgerSummary(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "service_ledger_role">,
  period: { start: string; end: string },
): Promise<ServiceLedgerSummary | null> {
  if (profile.role !== "ADMIN" && profile.service_ledger_role == null) return null;

  const [{ data: counts }, { data: money }] = await Promise.all([
    supabase.rpc("get_service_ledger_portfolio_counts", { p_period_start: period.start, p_period_end: period.end }),
    supabase.rpc("get_service_ledger_portfolio_money", { p_period_start: period.start, p_period_end: period.end }),
  ]);

  const countRows = (counts ?? []) as ServiceLedgerPortfolioCountsRow[];
  const moneyRows = (money ?? []) as ServiceLedgerPortfolioMoneyRow[];

  const unbilledMap = new Map<string, number>();
  const reimbursableMap = new Map<string, number>();
  for (const m of moneyRows) {
    if (m.unbilled_amount) unbilledMap.set(m.currency_code, (unbilledMap.get(m.currency_code) ?? 0) + Number(m.unbilled_amount));
    if (m.reimbursable_outstanding_amount) reimbursableMap.set(m.currency_code, (reimbursableMap.get(m.currency_code) ?? 0) + Number(m.reimbursable_outstanding_amount));
  }

  return {
    activeClientsCount: countRows.length,
    servicesThisPeriodCount: countRows.reduce((sum, r) => sum + Number(r.services_count), 0),
    hoursThisPeriodTotal: countRows.reduce((sum, r) => sum + Number(r.hours_total), 0),
    clientsRequiringBillingCount: countRows.filter((r) => r.requires_billing).length,
    unbilledByCurrency: Array.from(unbilledMap, ([currency_code, amount]) => ({ currency_code, amount })),
    reimbursableOutstandingByCurrency: Array.from(reimbursableMap, ([currency_code, amount]) => ({ currency_code, amount })),
  };
}

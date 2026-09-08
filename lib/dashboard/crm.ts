import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";
import type { CurrencyAmount } from "./types";

export type CrmSummary = {
  openCount: number;
  newLeadsCount: number;
  wonCount: number;
  lostCount: number;
  staleCount: number;
  nextActionOverdueCount: number;
  pipelineValueByCurrency: CurrencyAmount[];
};

/**
 * CRM Executive Summary — reuses the exact filters already live on
 * opportunities/dashboard/page.tsx (open = won_at/lost_at both null,
 * stale = get_stale_crm_opportunities(14)), just condensed to counts +
 * a pipeline-value rollup that page doesn't compute. Grouped by
 * currency_code (spec §17) — never summed across currencies.
 */
export async function getCrmSummary(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "crm_role">,
): Promise<CrmSummary | null> {
  if (profile.role !== "ADMIN" && profile.crm_role == null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: openOpps }, newLeads, won, lost, { data: stale }, nextActionOverdue] = await Promise.all([
    supabase.from("crm_opportunities").select("estimated_value, currency_code").is("won_at", null).is("lost_at", null),
    supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).not("won_at", "is", null),
    supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).not("lost_at", "is", null),
    supabase.rpc("get_stale_crm_opportunities", { p_days: 14 }),
    supabase.from("crm_opportunities").select("*", { count: "exact", head: true }).is("won_at", null).is("lost_at", null).not("next_action_date", "is", null).lt("next_action_date", today),
  ]);

  const opps = (openOpps ?? []) as { estimated_value: number | null; currency_code: string }[];
  const pipelineMap = new Map<string, number>();
  for (const o of opps) {
    if (!o.estimated_value) continue;
    pipelineMap.set(o.currency_code, (pipelineMap.get(o.currency_code) ?? 0) + Number(o.estimated_value));
  }

  return {
    openCount: opps.length,
    newLeadsCount: newLeads.count ?? 0,
    wonCount: won.count ?? 0,
    lostCount: lost.count ?? 0,
    staleCount: (stale ?? []).length,
    nextActionOverdueCount: nextActionOverdue.count ?? 0,
    pipelineValueByCurrency: Array.from(pipelineMap, ([currency_code, amount]) => ({ currency_code, amount })),
  };
}

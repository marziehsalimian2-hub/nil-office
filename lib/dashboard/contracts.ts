import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";

export type ContractsSummary = {
  activeCount: number;
  expiringCount: number;
  expiredStillActiveCount: number;
  suspendedCount: number;
};

/**
 * Contract Executive Summary — expiry has no auto-transition trigger in
 * this codebase (0022_contract_functions.sql's adjacency map only allows
 * a manual ACTIVE->EXPIRED), so "expiring"/"expired but still active"
 * are computed here the same way the Attention Engine computes them
 * (lib/dashboard/attention.ts), not trusted from the stored status.
 */
export async function getContractsSummary(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "contract_role">,
  expiryWindowDays: number,
): Promise<ContractsSummary | null> {
  if (profile.role !== "ADMIN" && profile.contract_role == null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const expiryWindow = new Date(Date.now() + expiryWindowDays * 86400000).toISOString().slice(0, 10);

  const [activeCount, expiringCount, expiredStillActiveCount, suspendedCount] = await Promise.all([
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"),
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "ACTIVE").not("expiry_date", "is", null).gte("expiry_date", today).lte("expiry_date", expiryWindow),
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "ACTIVE").not("expiry_date", "is", null).lt("expiry_date", today),
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "SUSPENDED"),
  ]);

  return {
    activeCount: activeCount.count ?? 0,
    expiringCount: expiringCount.count ?? 0,
    expiredStillActiveCount: expiredStillActiveCount.count ?? 0,
    suspendedCount: suspendedCount.count ?? 0,
  };
}

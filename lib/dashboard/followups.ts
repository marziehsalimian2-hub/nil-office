import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FollowupsSummary = { dueToday: number; overdue: number; upcoming: number };

/** No dedicated permission tier — followups open to any active user (0004_rls.sql). */
export async function getFollowupsSummary(supabase: SupabaseClient): Promise<FollowupsSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const [dueToday, overdue, upcoming] = await Promise.all([
    supabase.from("followups").select("*", { count: "exact", head: true }).eq("status", "OPEN").eq("due_date", today),
    supabase.from("followups").select("*", { count: "exact", head: true }).eq("status", "OPEN").lt("due_date", today),
    supabase.from("followups").select("*", { count: "exact", head: true }).eq("status", "OPEN").gt("due_date", today),
  ]);
  return { dueToday: dueToday.count ?? 0, overdue: overdue.count ?? 0, upcoming: upcoming.count ?? 0 };
}

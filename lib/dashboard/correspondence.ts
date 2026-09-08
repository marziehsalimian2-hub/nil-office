import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CorrespondenceSummary = {
  outgoingToday: number;
  incomingToday: number;
  waitingResponse: number;
  draftsInReview: number;
  recent: { id: string; direction: string; display_number: string | null; subject: string | null; status: string; created_at: string }[];
};

/** No dedicated permission tier — correspondence is open to any active user (0004_rls.sql), same as this codebase's original dashboard already assumed. */
export async function getCorrespondenceSummary(supabase: SupabaseClient): Promise<CorrespondenceSummary> {
  const start = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [outToday, inToday, waiting, drafts, { data: recent }] = await Promise.all([
    supabase.from("correspondence").select("*", { count: "exact", head: true }).eq("direction", "OUTGOING").gte("created_at", start),
    supabase.from("correspondence").select("*", { count: "exact", head: true }).eq("direction", "INCOMING").gte("created_at", start),
    supabase.from("correspondence").select("*", { count: "exact", head: true }).eq("status", "WAITING_RESPONSE"),
    supabase.from("correspondence").select("*", { count: "exact", head: true }).in("status", ["DRAFT", "REVIEW"]),
    supabase.from("correspondence").select("id, direction, display_number, subject, status, created_at").order("created_at", { ascending: false }).limit(6),
  ]);

  return {
    outgoingToday: outToday.count ?? 0,
    incomingToday: inToday.count ?? 0,
    waitingResponse: waiting.count ?? 0,
    draftsInReview: drafts.count ?? 0,
    recent: recent ?? [],
  };
}

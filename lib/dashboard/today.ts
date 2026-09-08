import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";

export type TodayItem = { id: string; title: string; kind: "task" | "followup" | "crm_next_action" | "milestone" | "deliverable"; overdue: boolean; navigation_target: string };
export type TodaySummary = { dueTodayCount: number; overdueCount: number; items: TodayItem[] };

/**
 * "امروز" (spec §7) — the current user's own operational commitments,
 * distinct from the company-wide Attention Center (spec §8: don't
 * confuse My Work with the executive view). Scoped to `userId` via
 * assigned_to/owner_user_id/responsible_user_id, not company-wide.
 */
export async function getTodaySummary(
  supabase: SupabaseClient,
  userId: string,
  profile: Pick<Profile, "role" | "crm_role" | "project_role">,
): Promise<TodaySummary> {
  const today = new Date().toISOString().slice(0, 10);
  const hasCrm = profile.role === "ADMIN" || profile.crm_role != null;
  const hasProject = profile.role === "ADMIN" || profile.project_role != null;

  const [{ data: myTasks }, { data: myFollowups }, crmNext, milestones] = await Promise.all([
    supabase.from("tasks").select("id, title, due_date").eq("assigned_to", userId).not("status", "in", "(DONE,CANCELLED)").lte("due_date", today),
    supabase.from("followups").select("id, title, due_date").eq("assigned_to", userId).eq("status", "OPEN").lte("due_date", today),
    hasCrm
      ? supabase.from("crm_opportunities").select("id, title, next_action_date").eq("owner_user_id", userId).is("won_at", null).is("lost_at", null).not("next_action_date", "is", null).lte("next_action_date", today)
      : Promise.resolve({ data: [] }),
    hasProject
      ? supabase.from("project_milestones").select("id, title, due_date").eq("responsible_user_id", userId).not("status", "in", "(COMPLETED,CANCELLED)").lte("due_date", today)
      : Promise.resolve({ data: [] }),
  ]);

  const items: TodayItem[] = [];
  for (const t of (myTasks ?? []) as { id: string; title: string; due_date: string }[]) {
    items.push({ id: t.id, title: t.title, kind: "task", overdue: t.due_date < today, navigation_target: `/tasks/${t.id}` });
  }
  for (const f of (myFollowups ?? []) as { id: string; title: string; due_date: string }[]) {
    items.push({ id: f.id, title: f.title, kind: "followup", overdue: f.due_date < today, navigation_target: `/followups` });
  }
  for (const o of (crmNext.data ?? []) as { id: string; title: string; next_action_date: string }[]) {
    items.push({ id: o.id, title: o.title, kind: "crm_next_action", overdue: o.next_action_date < today, navigation_target: `/opportunities/${o.id}` });
  }
  for (const m of (milestones.data ?? []) as { id: string; title: string; due_date: string }[]) {
    items.push({ id: m.id, title: m.title, kind: "milestone", overdue: m.due_date < today, navigation_target: `/projects` });
  }

  return {
    dueTodayCount: items.filter((i) => !i.overdue).length,
    overdueCount: items.filter((i) => i.overdue).length,
    items,
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeProjectHealth } from "@/lib/project-health";
import type { Profile, ProjectProgressSummary } from "@/lib/types/database";

export type ProjectsSummary = {
  activeCount: number;
  atRiskCount: number;
  delayedCount: number;
  endingSoonCount: number;
  overdueTaskCount: number;
  blockedTaskCount: number;
  pendingDeliverableCount: number;
};

/**
 * Project Executive Summary — reuses get_project_progress_summary() +
 * computeProjectHealth() exactly as projects/dashboard/page.tsx already
 * does (spec §20: don't build a second health engine). endingSoonDays
 * comes from app_settings (admin-configurable, decision #4 in the plan).
 */
export async function getProjectsSummary(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "project_role">,
  endingSoonDays: number,
): Promise<ProjectsSummary | null> {
  if (profile.role !== "ADMIN" && profile.project_role == null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const endingSoonWindow = new Date(Date.now() + endingSoonDays * 86400000).toISOString().slice(0, 10);

  const [{ data: openProjects }, { data: summaryRows }, overdueTasks, blockedTasks, pendingDeliverables, activeCount] = await Promise.all([
    supabase.from("projects").select("id, status, planned_end_date").not("status", "in", "(COMPLETED,CANCELLED,ARCHIVED)"),
    supabase.rpc("get_project_progress_summary"),
    supabase.from("tasks").select("*", { count: "exact", head: true }).lt("due_date", today).not("status", "in", "(DONE,CANCELLED)"),
    supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "BLOCKED"),
    supabase.from("project_deliverables").select("*", { count: "exact", head: true }).in("status", ["PLANNED", "IN_PROGRESS", "READY_FOR_REVIEW"]),
    supabase.from("projects").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"),
  ]);

  const summaryMap = new Map(((summaryRows ?? []) as ProjectProgressSummary[]).map((s) => [s.project_id, s]));
  let atRiskCount = 0;
  let delayedCount = 0;
  let endingSoonCount = 0;
  for (const p of (openProjects ?? []) as { id: string; status: string; planned_end_date: string | null }[]) {
    const summary = summaryMap.get(p.id);
    if (summary) {
      const health = computeProjectHealth(p, summary);
      if (health === "AT_RISK") atRiskCount++;
      if (health === "DELAYED") delayedCount++;
    }
    if (p.planned_end_date && p.planned_end_date >= today && p.planned_end_date <= endingSoonWindow) endingSoonCount++;
  }

  return {
    activeCount: activeCount.count ?? 0,
    atRiskCount,
    delayedCount,
    endingSoonCount,
    overdueTaskCount: overdueTasks.count ?? 0,
    blockedTaskCount: blockedTasks.count ?? 0,
    pendingDeliverableCount: pendingDeliverables.count ?? 0,
  };
}

import "server-only";
import { z } from "zod";
import { computeProjectHealth, PROJECT_HEALTH_LABEL } from "@/lib/project-health";
import type { ProjectProgressSummary } from "@/lib/types/database";
import type { ActionDefinition } from "./types";

/** Reuses get_project_progress_summary() + computeProjectHealth() exactly like every other page that shows project health — no parallel health logic (spec §20/§48). */
export const getProjectStatus: ActionDefinition<{ project_id: string }> = {
  name: "GET_PROJECT_STATUS",
  description: "وضعیت یک پروژهٔ مشخص: پیشرفت، سلامت (طبق برنامه/در معرض خطر/عقب‌افتاده/تکمیل‌شده)، کارهای عقب‌افتاده/مسدود، مایلستون عقب‌افتاده. ابتدا با SEARCH_PROJECT شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ project_id: z.string().uuid() }),
  requiredAccess: (p) => p.role === "ADMIN" || p.project_role != null,
  handler: async (input, ctx) => {
    const [{ data: project }, { data: summaryRows }] = await Promise.all([
      ctx.supabase.from("projects").select("id, title, display_number, status, planned_end_date, project_manager_id").eq("id", input.project_id).single(),
      ctx.supabase.rpc("get_project_progress_summary"),
    ]);
    if (!project) return { data: { note: "پروژه‌ای با این شناسه پیدا نشد یا دسترسی ندارید." } };
    const summary = ((summaryRows ?? []) as ProjectProgressSummary[]).find((s) => s.project_id === project.id);
    const health = summary ? computeProjectHealth(project, summary) : null;
    return {
      data: { project, progress: summary ?? null, health, healthLabel: health ? PROJECT_HEALTH_LABEL[health] : null },
      cards: [{ kind: "project", id: project.id, title: project.display_number ?? project.title, subtitle: health ? PROJECT_HEALTH_LABEL[health] : undefined, href: `/projects/${project.id}` }],
    };
  },
};

export const projectActions: ActionDefinition<any>[] = [getProjectStatus];

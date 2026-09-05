/**
 * Deterministic project health (spec §28) — a pure function over
 * already-fetched data, not a database concept. Rules are intentionally
 * transparent and inspectable, no AI/scoring involved:
 *   COMPLETED -> project.status is COMPLETED or ARCHIVED.
 *   DELAYED   -> planned_end_date has passed and the project isn't closed.
 *   AT_RISK   -> an overdue milestone or a BLOCKED task exists.
 *   ON_TRACK  -> none of the above.
 */

export type ProjectHealth = "ON_TRACK" | "AT_RISK" | "DELAYED" | "COMPLETED";

export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string> = {
  ON_TRACK: "طبق برنامه",
  AT_RISK: "در معرض خطر",
  DELAYED: "عقب‌افتاده",
  COMPLETED: "تکمیل‌شده",
};

/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const PROJECT_HEALTH_TONE: Record<ProjectHealth, string> = {
  ON_TRACK: "status-received",
  AT_RISK: "status-waiting",
  DELAYED: "status-cancelled",
  COMPLETED: "status-closed",
};

export function computeProjectHealth(
  project: { status: string; planned_end_date: string | null },
  flags: { has_overdue_milestone: boolean; has_blocked_task: boolean },
): ProjectHealth {
  if (project.status === "COMPLETED" || project.status === "ARCHIVED") return "COMPLETED";

  const today = new Date().toISOString().slice(0, 10);
  const isClosed = ["COMPLETED", "CANCELLED", "ARCHIVED"].includes(project.status);
  if (!isClosed && project.planned_end_date && project.planned_end_date < today) return "DELAYED";

  if (flags.has_overdue_milestone || flags.has_blocked_task) return "AT_RISK";

  return "ON_TRACK";
}

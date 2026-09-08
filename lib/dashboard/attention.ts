import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeProjectHealth } from "@/lib/project-health";
import type { AttentionItem } from "./types";
import type { Profile, ProjectProgressSummary } from "@/lib/types/database";

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, HIGH: 2, WARNING: 1, INFO: 0 };

function daysBetween(a: string, today: string): number {
  return Math.round((new Date(today).getTime() - new Date(a).getTime()) / 86400000);
}

/**
 * Deterministic, rule-based cross-module exception aggregator (spec
 * §45/§46) — NOT an AI judgment call. Every rule reuses the exact filter
 * the source module's own list/dashboard page already uses for the same
 * concept (see the plan's decision #2), so a count here always matches
 * what that module's own page would show for the same filter.
 *
 * Each query is skipped entirely — not just hidden in the UI — when the
 * profile lacks that module's role, both as a perf optimization (RLS
 * would return empty rows anyway) and as the explicit permission gate
 * spec §58 demands ("hiding cards is NOT sufficient").
 */
export async function getAttentionItems(
  supabase: SupabaseClient,
  profile: Pick<Profile, "role" | "project_role" | "invoice_role" | "contract_role" | "crm_role">,
  thresholds: { contractExpiryDays: number },
): Promise<AttentionItem[]> {
  const isAdmin = profile.role === "ADMIN";
  const hasProject = isAdmin || profile.project_role != null;
  const hasInvoice = isAdmin || profile.invoice_role != null;
  const hasContract = isAdmin || profile.contract_role != null;
  const hasCrm = isAdmin || profile.crm_role != null;

  const today = new Date().toISOString().slice(0, 10);
  const expiryWindow = new Date(Date.now() + thresholds.contractExpiryDays * 86400000).toISOString().slice(0, 10);

  const items: AttentionItem[] = [];

  // --- Projects (health) — computed first so overdue-task dedup (spec §48) can use it. ---
  const flaggedProjectIds = new Set<string>();
  if (hasProject) {
    const [{ data: openProjects }, { data: summaryRows }] = await Promise.all([
      supabase.from("projects").select("id, title, display_number, status, planned_end_date").not("status", "in", "(COMPLETED,CANCELLED,ARCHIVED)"),
      supabase.rpc("get_project_progress_summary"),
    ]);
    const summaryMap = new Map(((summaryRows ?? []) as ProjectProgressSummary[]).map((s) => [s.project_id, s]));
    for (const p of (openProjects ?? []) as { id: string; title: string; display_number: string | null; status: string; planned_end_date: string | null }[]) {
      const summary = summaryMap.get(p.id);
      if (!summary) continue;
      const health = computeProjectHealth({ status: p.status, planned_end_date: p.planned_end_date }, summary);
      const label = p.display_number ?? p.title;
      if (health === "DELAYED") {
        flaggedProjectIds.add(p.id);
        items.push({
          id: `project-delayed-${p.id}`, source_type: "project", source_id: p.id, severity: "HIGH", rule_code: "PROJECT_DELAYED",
          title: `پروژهٔ عقب‌افتاده — ${label}`,
          description: summary.overdue_task_count > 0 ? `${summary.overdue_task_count} کار عقب‌افتاده دارد.` : "از تاریخ پایان برنامه‌ریزی‌شده گذشته است.",
          responsible_user_id: null, due_date: p.planned_end_date, days_overdue: p.planned_end_date ? daysBetween(p.planned_end_date, today) : null,
          navigation_target: `/projects/${p.id}`,
        });
      } else if (health === "AT_RISK") {
        flaggedProjectIds.add(p.id);
        items.push({
          id: `project-at-risk-${p.id}`, source_type: "project", source_id: p.id, severity: "WARNING", rule_code: "PROJECT_AT_RISK",
          title: `پروژهٔ در معرض خطر — ${label}`,
          description: summary.has_blocked_task ? "کار مسدودشده دارد." : "مایلستون عقب‌افتاده دارد.",
          responsible_user_id: null, due_date: null, days_overdue: null,
          navigation_target: `/projects/${p.id}`,
        });
      }
    }

    const { data: overdueMilestones } = await supabase
      .from("project_milestones")
      .select("id, title, due_date, project_id, responsible_user_id")
      .lt("due_date", today)
      .not("status", "in", "(COMPLETED,CANCELLED)");
    for (const m of (overdueMilestones ?? []) as { id: string; title: string; due_date: string; project_id: string; responsible_user_id: string | null }[]) {
      items.push({
        id: `milestone-${m.id}`, source_type: "milestone", source_id: m.id, severity: "WARNING", rule_code: "MILESTONE_OVERDUE",
        title: `مایلستون عقب‌افتاده — ${m.title}`, description: `${daysBetween(m.due_date, today)} روز از موعد گذشته است.`,
        responsible_user_id: m.responsible_user_id, due_date: m.due_date, days_overdue: daysBetween(m.due_date, today),
        navigation_target: `/projects/${m.project_id}`,
      });
    }

    const { data: overdueDeliverables } = await supabase
      .from("project_deliverables")
      .select("id, title, due_date, project_id, responsible_user_id")
      .lt("due_date", today)
      .not("status", "in", "(ACCEPTED,REJECTED,CANCELLED)");
    for (const d of (overdueDeliverables ?? []) as { id: string; title: string; due_date: string; project_id: string; responsible_user_id: string | null }[]) {
      items.push({
        id: `deliverable-${d.id}`, source_type: "deliverable", source_id: d.id, severity: "WARNING", rule_code: "DELIVERABLE_OVERDUE",
        title: `تحویل‌دادنی عقب‌افتاده — ${d.title}`, description: `${daysBetween(d.due_date, today)} روز از موعد گذشته است.`,
        responsible_user_id: d.responsible_user_id, due_date: d.due_date, days_overdue: daysBetween(d.due_date, today),
        navigation_target: `/projects/${d.project_id}`,
      });
    }
  }

  // --- Tasks — every active user (no dedicated permission tier, spec confirms broad RLS). ---
  const { data: overdueTasks } = await supabase
    .from("tasks")
    .select("id, title, due_date, priority, status, project_id, assigned_to")
    .lt("due_date", today)
    .not("status", "in", "(DONE,CANCELLED)");
  for (const t of (overdueTasks ?? []) as { id: string; title: string; due_date: string; priority: string; status: string; project_id: string | null; assigned_to: string | null }[]) {
    // Dedup (spec §48): a task inside an already-flagged project is
    // covered by that project's own attention card and its overdue_task_count.
    if (t.project_id && flaggedProjectIds.has(t.project_id)) continue;
    items.push({
      id: `task-overdue-${t.id}`, source_type: "task", source_id: t.id, severity: t.priority === "URGENT" || t.priority === "HIGH" ? "HIGH" : "WARNING",
      rule_code: "TASK_OVERDUE", title: `کار عقب‌افتاده — ${t.title}`, description: `${daysBetween(t.due_date, today)} روز از موعد گذشته است.`,
      responsible_user_id: t.assigned_to, due_date: t.due_date, days_overdue: daysBetween(t.due_date, today),
      navigation_target: `/tasks/${t.id}`,
    });
  }

  const { data: blockedUrgent } = await supabase
    .from("tasks").select("id, title, assigned_to, project_id").eq("status", "BLOCKED").eq("priority", "URGENT");
  for (const t of (blockedUrgent ?? []) as { id: string; title: string; assigned_to: string | null; project_id: string | null }[]) {
    items.push({
      id: `task-blocked-urgent-${t.id}`, source_type: "task", source_id: t.id, severity: "HIGH", rule_code: "TASK_BLOCKED_URGENT",
      title: `کار فوری مسدودشده — ${t.title}`, description: "این کار فوری در وضعیت مسدود قرار دارد.",
      responsible_user_id: t.assigned_to, due_date: null, days_overdue: null, navigation_target: `/tasks/${t.id}`,
    });
  }

  // --- Follow-ups — every active user. ---
  const { data: overdueFollowups } = await supabase
    .from("followups").select("id, title, due_date, assigned_to").eq("status", "OPEN").lt("due_date", today);
  for (const f of (overdueFollowups ?? []) as { id: string; title: string; due_date: string; assigned_to: string | null }[]) {
    items.push({
      id: `followup-${f.id}`, source_type: "followup", source_id: f.id, severity: "WARNING", rule_code: "FOLLOWUP_OVERDUE",
      title: `پیگیری عقب‌افتاده — ${f.title}`, description: `${daysBetween(f.due_date, today)} روز از موعد گذشته است.`,
      responsible_user_id: f.assigned_to, due_date: f.due_date, days_overdue: daysBetween(f.due_date, today),
      navigation_target: `/followups`,
    });
  }

  // --- Invoices ---
  if (hasInvoice) {
    const { data: overdueInvoices } = await supabase
      .from("sales_documents").select("id, display_number, due_date, customer_legal_name_snapshot")
      .lt("due_date", today).in("status", ["ISSUED", "PARTIALLY_SETTLED"]);
    for (const inv of (overdueInvoices ?? []) as { id: string; display_number: string | null; due_date: string; customer_legal_name_snapshot: string }[]) {
      const days = daysBetween(inv.due_date, today);
      items.push({
        id: `invoice-${inv.id}`, source_type: "invoice", source_id: inv.id, severity: days >= 14 ? "HIGH" : "WARNING", rule_code: "INVOICE_OVERDUE",
        title: `فاکتور ${inv.display_number ?? "—"} — عقب‌افتاده از سررسید`, description: `${days} روز از سررسید پرداخت گذشته است (${inv.customer_legal_name_snapshot}).`,
        responsible_user_id: null, due_date: inv.due_date, days_overdue: days, navigation_target: `/invoices/${inv.id}`,
      });
    }
  }

  // --- Contracts ---
  if (hasContract) {
    const { data: expiring } = await supabase
      .from("contracts").select("id, title, display_number, expiry_date").eq("status", "ACTIVE")
      .not("expiry_date", "is", null).lte("expiry_date", expiryWindow).gte("expiry_date", today);
    for (const c of (expiring ?? []) as { id: string; title: string; display_number: string | null; expiry_date: string }[]) {
      const daysLeft = daysBetween(today, c.expiry_date);
      items.push({
        id: `contract-expiring-${c.id}`, source_type: "contract", source_id: c.id, severity: daysLeft <= 7 ? "HIGH" : "WARNING", rule_code: "CONTRACT_EXPIRING",
        title: `${c.display_number ?? c.title} — نزدیک به پایان قرارداد`, description: `${daysLeft} روز تا پایان قرارداد باقی مانده است.`,
        responsible_user_id: null, due_date: c.expiry_date, days_overdue: null, navigation_target: `/contracts/${c.id}`,
      });
    }
    const { data: expiredActive } = await supabase
      .from("contracts").select("id, title, display_number, expiry_date").eq("status", "ACTIVE")
      .not("expiry_date", "is", null).lt("expiry_date", today);
    for (const c of (expiredActive ?? []) as { id: string; title: string; display_number: string | null; expiry_date: string }[]) {
      items.push({
        id: `contract-expired-active-${c.id}`, source_type: "contract", source_id: c.id, severity: "CRITICAL", rule_code: "CONTRACT_EXPIRED_STILL_ACTIVE",
        title: `${c.display_number ?? c.title} — منقضی‌شده اما همچنان فعال`, description: `${daysBetween(c.expiry_date, today)} روز از تاریخ پایان گذشته و وضعیت هنوز «فعال» است.`,
        responsible_user_id: null, due_date: c.expiry_date, days_overdue: daysBetween(c.expiry_date, today), navigation_target: `/contracts/${c.id}`,
      });
    }
  }

  // --- CRM ---
  if (hasCrm) {
    const { data: stale } = await supabase.rpc("get_stale_crm_opportunities", { p_days: 14 });
    for (const o of (stale ?? []) as { id: string; opportunity_number: string; title: string; days_stale: number }[]) {
      items.push({
        id: `crm-stale-${o.id}`, source_type: "opportunity", source_id: o.id, severity: "WARNING", rule_code: "CRM_STALE",
        title: `${o.opportunity_number} — بدون فعالیت`, description: `${o.days_stale} روز بدون فعالیت مانده است.`,
        responsible_user_id: null, due_date: null, days_overdue: o.days_stale, navigation_target: `/opportunities/${o.id}`,
      });
    }
    const { data: overdueNextAction } = await supabase
      .from("crm_opportunities").select("id, opportunity_number, title, next_action, next_action_date, owner_user_id")
      .is("won_at", null).is("lost_at", null).not("next_action_date", "is", null).lt("next_action_date", today);
    for (const o of (overdueNextAction ?? []) as { id: string; opportunity_number: string; title: string; next_action: string | null; next_action_date: string; owner_user_id: string | null }[]) {
      items.push({
        id: `crm-next-action-${o.id}`, source_type: "opportunity", source_id: o.id, severity: "WARNING", rule_code: "CRM_NEXT_ACTION_OVERDUE",
        title: `${o.opportunity_number} — اقدام بعدی عقب‌افتاده`, description: o.next_action ? `اقدام بعدی: ${o.next_action}` : "اقدام بعدی از موعد گذشته است.",
        responsible_user_id: o.owner_user_id, due_date: o.next_action_date, days_overdue: daysBetween(o.next_action_date, today),
        navigation_target: `/opportunities/${o.id}`,
      });
    }
  }

  items.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return (b.days_overdue ?? 0) - (a.days_overdue ?? 0);
  });

  return items;
}

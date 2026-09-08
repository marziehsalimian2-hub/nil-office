import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActivityItem = { id: string; text: string; created_at: string; navigation_target: string };

/**
 * Recent Activity (spec §29) — DELIBERATELY narrower than the spec's own
 * example list (no "Invoice issued"/"Payment recorded"/"Contract
 * activated": those transitions have no existing reliable semantic
 * write_log() marker in this codebase, only generic tg_audit UPDATED
 * rows with a raw jsonb diff — showing those raw would violate this same
 * spec's "no noisy technical audit events" rule, and reconstructing the
 * transition from the diff would be exactly the unreliable inference the
 * spec bans elsewhere. See the plan's decision #7 for the full
 * reasoning; this is a documented v1 limitation, not an oversight.
 *
 * Sources actually used, all already explicitly semantic today:
 *   - activity_logs: CRM WON/LOST (write_log calls inside close_
 *     opportunity_won/lost, 0043), Correspondence FINALIZED
 *     (finalize_correspondence/register_incoming, 0003), Project
 *     FINALIZED (finalize_project, 0052 — numbering issuance, DRAFT ->
 *     PLANNED).
 *   - trade_offer_events: the Trade Portal's own rich event trail.
 *   - tasks where status='DONE' (derive-at-query-time, same doctrine
 *     used everywhere else in this codebase for status-based facts).
 *   - project_deliverables where status='ACCEPTED', ordered by the
 *     already-existing accepted_at column.
 */
export async function getRecentActivity(supabase: SupabaseClient, limit = 15): Promise<ActivityItem[]> {
  const [{ data: logs }, { data: tradeEvents }, { data: doneTasks }, { data: acceptedDeliverables }] = await Promise.all([
    supabase
      .from("activity_logs")
      .select("id, entity_type, entity_id, action, new_value, created_at")
      .in("action", ["WON", "LOST", "FINALIZED"])
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("trade_offer_events")
      .select("id, offer_id, event_type, created_at")
      .in("event_type", ["OFFER_PUBLISHED", "BUYER_RESPONSE_SUBMITTED", "DOCUMENT_UPLOADED", "OFFER_CLOSED"])
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.from("tasks").select("id, title, updated_at").eq("status", "DONE").order("updated_at", { ascending: false }).limit(limit),
    supabase.from("project_deliverables").select("id, title, project_id, accepted_at").eq("status", "ACCEPTED").not("accepted_at", "is", null).order("accepted_at", { ascending: false }).limit(limit),
  ]);

  const items: ActivityItem[] = [];

  for (const l of (logs ?? []) as { id: string; entity_type: string; entity_id: string; action: string; new_value: Record<string, unknown> | null; created_at: string }[]) {
    if (l.entity_type === "crm_opportunities") {
      items.push({ id: `log-${l.id}`, text: l.action === "WON" ? "فرصت تجاری موفق شد" : "فرصت تجاری ازدست‌رفته اعلام شد", created_at: l.created_at, navigation_target: `/opportunities/${l.entity_id}` });
    } else if (l.entity_type === "correspondence") {
      items.push({ id: `log-${l.id}`, text: `نامه ${(l.new_value?.display_number as string) ?? ""} ثبت نهایی شد`, created_at: l.created_at, navigation_target: `/correspondence/${l.entity_id}` });
    } else if (l.entity_type === "projects") {
      items.push({ id: `log-${l.id}`, text: `پروژه ${(l.new_value?.display_number as string) ?? ""} شماره‌گذاری شد`, created_at: l.created_at, navigation_target: `/projects/${l.entity_id}` });
    }
  }

  const TRADE_EVENT_TEXT: Record<string, string> = {
    OFFER_PUBLISHED: "آفر تجاری منتشر شد",
    BUYER_RESPONSE_SUBMITTED: "خریدار به یک آفر پاسخ داد",
    DOCUMENT_UPLOADED: "خریدار مدرک LOI/ICPO بارگذاری کرد",
    OFFER_CLOSED: "آفر تجاری بسته شد",
  };
  for (const e of (tradeEvents ?? []) as { id: string; offer_id: string; event_type: string; created_at: string }[]) {
    items.push({ id: `trade-${e.id}`, text: TRADE_EVENT_TEXT[e.event_type] ?? e.event_type, created_at: e.created_at, navigation_target: `/trade/${e.offer_id}` });
  }

  for (const t of (doneTasks ?? []) as { id: string; title: string; updated_at: string }[]) {
    items.push({ id: `task-${t.id}`, text: `کار «${t.title}» تکمیل شد`, created_at: t.updated_at, navigation_target: `/tasks/${t.id}` });
  }

  for (const d of (acceptedDeliverables ?? []) as { id: string; title: string; project_id: string; accepted_at: string }[]) {
    items.push({ id: `deliverable-${d.id}`, text: `تحویل‌دادنی «${d.title}» پذیرفته شد`, created_at: d.accepted_at, navigation_target: `/projects/${d.project_id}` });
  }

  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return items.slice(0, limit);
}

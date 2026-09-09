import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertTaskDraftCore } from "@/app/actions/tasks";
import { insertFollowupDraftCore } from "@/app/actions/entities";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Every write action's executor — called ONLY from confirmPendingAction
 * below, never from the chat route directly and never from the LLM's
 * own turn. Each executor calls the SAME non-redirecting core the real
 * form action uses (app/actions/tasks.ts / app/actions/entities.ts) —
 * one insert path shared by the UI and the Assistant, not a duplicate.
 */
const WRITE_EXECUTORS: Record<
  string,
  (payload: Record<string, unknown>, supabase: SupabaseClient, userId: string) => Promise<{ data: { id: string } } | { error: string }>
> = {
  CREATE_TASK_DRAFT: (payload, supabase, userId) => insertTaskDraftCore(supabase, userId, payload as never),
  CREATE_FOLLOWUP_DRAFT: (payload, supabase, userId) => insertFollowupDraftCore(supabase, userId, payload as never),
};

/**
 * Proposes a write action: supersedes any prior PENDING proposal for
 * the same (user, action) — spec §18's "a changed request invalidates
 * the old confirmation" — then inserts a fresh PENDING row. This is the
 * ONLY way an assistant_pending_actions row is ever created.
 */
export async function createPendingAction(
  supabase: SupabaseClient,
  userId: string,
  actionName: string,
  payload: Record<string, unknown>,
  previewText: string,
): Promise<{ pendingActionId: string; previewText: string; expiresAt: string }> {
  await supabase
    .from("assistant_pending_actions")
    .update({ status: "SUPERSEDED", resolved_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("action_name", actionName)
    .eq("status", "PENDING");

  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("assistant_pending_actions")
    .insert({
      user_id: userId,
      action_name: actionName,
      payload,
      payload_hash: hashPayload(payload),
      preview_text: previewText,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`failed to create pending action: ${error.message}`);

  return { pendingActionId: data.id, previewText, expiresAt };
}

export type ConfirmResult = { ok: true; resultId: string } | { ok: false; error: string };

/**
 * The entire Confirmation Engine boils down to this one atomic
 * conditional UPDATE (spec §17/§40): PENDING -> CONFIRMED only if it's
 * still this user's row, still PENDING, and not expired. Zero rows back
 * covers every "can't confirm" case uniformly — already consumed,
 * expired, superseded by a newer proposal, or someone else's row — with
 * one generic, safe message, never a stack trace or a guess at which
 * case it was.
 *
 * Ordering note: the row is claimed (marked CONFIRMED) BEFORE the
 * insert executes, not after — this is what makes a double-click safe
 * (the second call finds zero PENDING rows and does nothing) at the
 * cost of a rare edge case where the claim succeeds but the insert then
 * fails (e.g. a referenced company was deleted in the few minutes since
 * the proposal). That failure is reported honestly (spec §38 — never
 * pretend success) and the row simply stays "spent"; the user asks
 * again to get a fresh proposal, rather than the system silently
 * retrying a stale one.
 */
export async function confirmPendingAction(supabase: SupabaseClient, userId: string, pendingActionId: string): Promise<ConfirmResult> {
  const { data: claimed, error: claimErr } = await supabase
    .from("assistant_pending_actions")
    .update({ status: "CONFIRMED", resolved_at: new Date().toISOString() })
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .gt("expires_at", new Date().toISOString())
    .select("action_name, payload")
    .single();

  if (claimErr || !claimed) {
    return { ok: false, error: "این درخواست دیگر قابل تأیید نیست (منقضی شده، قبلاً پردازش شده، یا با درخواست جدیدتری جایگزین شده است)." };
  }

  const executor = WRITE_EXECUTORS[claimed.action_name];
  if (!executor) {
    console.error("[assistant] confirmPendingAction: unknown action_name", claimed.action_name);
    return { ok: false, error: "نوع عملیات نامعتبر است." };
  }

  const result = await executor(claimed.payload as Record<string, unknown>, supabase, userId);
  const outcome = "error" in result ? "FAILED" : "CONFIRMED";
  await supabase.rpc("assistant_write_log", { p_pending_action_id: pendingActionId, p_action_name: claimed.action_name, p_result: outcome });

  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, resultId: result.data.id };
}

export async function cancelPendingAction(supabase: SupabaseClient, userId: string, pendingActionId: string): Promise<{ ok: boolean }> {
  const { data } = await supabase
    .from("assistant_pending_actions")
    .update({ status: "CANCELLED", resolved_at: new Date().toISOString() })
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .select("id")
    .single();
  if (data) await supabase.rpc("assistant_write_log", { p_pending_action_id: pendingActionId, p_action_name: "CANCEL", p_result: "CANCELLED" });
  return { ok: !!data };
}

/**
 * Deterministic confirmation-by-plain-text (spec §19): a bare "باشه" is
 * only ever treated as confirmation when exactly one PENDING action
 * exists for this user — never guessed, never resolved by the LLM.
 */
const AFFIRMATIVE_PHRASES = new Set(["باشه", "بله", "تایید", "تأیید", "اوکی", "ok", "yes", "بزن", "انجام بده", "ثبت کن", "ثبت شود"]);

export function isAffirmativePhrase(text: string): boolean {
  return AFFIRMATIVE_PHRASES.has(text.trim().toLowerCase());
}

export async function findSinglePendingAction(supabase: SupabaseClient, userId: string): Promise<{ id: string; preview_text: string } | null> {
  const { data } = await supabase
    .from("assistant_pending_actions")
    .select("id, preview_text")
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .gt("expires_at", new Date().toISOString());
  if (!data || data.length !== 1) return null;
  return data[0];
}

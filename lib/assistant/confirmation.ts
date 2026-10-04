import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertTaskDraftCore } from "@/app/actions/tasks";
import { insertFollowupDraftCore } from "@/app/actions/entities";
import { createChequeDraftCore, prepareChequeCore } from "@/app/actions/cheques";
import { createLetterDraftCore, finalizeLetterCore, createAndRegisterIncomingCore } from "@/app/actions/correspondence";
import { createInvoiceDraftCore, issueSalesDocumentCore } from "@/app/actions/invoices";
import { quickAddServiceEntryCore } from "@/app/actions/service-entries";
import { addTimeEntryDraftCore } from "@/app/actions/service-time-entries";
import { addServiceExpenseDraftCore } from "@/app/actions/service-expenses";
import { generateClientServiceReportCore } from "@/app/actions/service-reports";
import { getAction } from "@/lib/assistant/actions/registry";
import { hasAccess } from "@/lib/assistant/actions/types";
import { hashPayload, verifyPayloadHash, isConfirmableByPhrase } from "@/lib/assistant/security";
import { auditAssistant } from "@/lib/assistant/usage";
import type { Profile } from "@/lib/types/database";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Every write action's executor — called ONLY from confirmPendingAction
 * below, never from the chat route directly and never from the LLM's
 * own turn. Each executor calls the SAME non-redirecting core the real
 * form action uses (app/actions/tasks.ts / app/actions/entities.ts) —
 * one insert path shared by the UI and the Assistant, not a duplicate.
 */
export const WRITE_EXECUTORS: Record<
  string,
  (payload: Record<string, unknown>, supabase: SupabaseClient, userId: string) => Promise<{ data: { id: string } } | { error: string }>
> = {
  CREATE_TASK_DRAFT: (payload, supabase, userId) => insertTaskDraftCore(supabase, userId, payload as never),
  CREATE_FOLLOWUP_DRAFT: (payload, supabase, userId) => insertFollowupDraftCore(supabase, userId, payload as never),
  CREATE_CHEQUE_DRAFT: (payload, supabase, userId) => createChequeDraftCore(supabase, userId, payload as never),
  PREPARE_CHEQUE_PRINT: (payload, supabase, userId) => prepareChequeCore(supabase, userId, payload as never),
  CREATE_LETTER_DRAFT: (payload, supabase, userId) => createLetterDraftCore(supabase, userId, payload as never),
  FINALIZE_LETTER: (payload, supabase, userId) => finalizeLetterCore(supabase, userId, payload as never),
  REGISTER_INCOMING_LETTER: (payload, supabase, userId) => createAndRegisterIncomingCore(supabase, userId, payload as never),
  CREATE_INVOICE_DRAFT: (payload, supabase, userId) => createInvoiceDraftCore(supabase, userId, payload as never),
  ISSUE_SALES_DOCUMENT: (payload, supabase, userId) => issueSalesDocumentCore(supabase, userId, payload as never),
  CREATE_SERVICE_ENTRY_DRAFT: (payload, supabase, userId) => quickAddServiceEntryCore(supabase, userId, payload as never),
  ADD_TIME_ENTRY_DRAFT: (payload, supabase, userId) => addTimeEntryDraftCore(supabase, userId, payload as never),
  ADD_SERVICE_EXPENSE_DRAFT: (payload, supabase, userId) => addServiceExpenseDraftCore(supabase, userId, payload as never),
  PREPARE_CLIENT_SERVICE_REPORT: (payload, supabase, userId) => generateClientServiceReportCore(supabase, userId, payload as never),
};

/**
 * Proposes a write action: supersedes any prior PENDING proposal for
 * the same (user, action) — spec §18's "a changed request invalidates
 * the old confirmation" — then inserts a fresh PENDING row. This is the
 * ONLY way an assistant_pending_actions row is ever created. The stored
 * hash is a keyed HMAC bound to (user, action, canonical payload) —
 * see lib/assistant/security.ts — verified again at confirm time.
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
      payload_hash: hashPayload(payload, userId, actionName),
      preview_text: previewText,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`failed to create pending action: ${error.message}`);

  await auditAssistant(supabase, userId, "PROPOSED", actionName, { pending_action_id: data.id });
  return { pendingActionId: data.id, previewText, expiresAt };
}

export type ConfirmResult = { ok: true; resultId: string; actionName: string } | { ok: false; error: string };

const NOT_CONFIRMABLE_TEXT = "این درخواست دیگر قابل تأیید نیست (منقضی شده، قبلاً پردازش شده، یا با درخواست جدیدتری جایگزین شده است).";
const PHRASE_NOT_ALLOWED_TEXT = "این عملیات رسمی و برگشت‌ناپذیر است؛ لطفاً دکمهٔ «تأیید» زیر پیش‌نمایش را بزنید (تأیید با نوشتن «باشه» برای این عملیات کار نمی‌کند).";

/**
 * The Confirmation Engine (spec §17/§39/§40/§41). Order matters:
 *
 *  1. READ the proposal (own row only). Missing / not PENDING / expired -> one generic, safe message.
 *  2. Risk gate: a bare plain-text «باشه» may only confirm LOW/MEDIUM — HIGH/CRITICAL need the explicit button.
 *  3. Payload binding: the HMAC (bound to user + action + canonical payload) must verify, else the
 *     proposal is CANCELLED and the executor is NEVER run (a hand-edited / forged row dies here).
 *  4. Permission REVALIDATION at execute time: the profile is reloaded now — a user deactivated or
 *     demoted since the proposal cannot execute it. Denied -> CANCELLED + audit.
 *  5. Atomic claim: PENDING -> CONFIRMED in ONE conditional UPDATE (id + owner + still PENDING + not
 *     expired). Zero rows (a concurrent double-tap, expiry) -> nothing executes. The row is claimed
 *     BEFORE the executor runs, so a double-click can never create two records; if the executor then
 *     fails the failure is reported honestly (spec §38) and the row stays "spent" — the user asks again
 *     for a fresh proposal rather than the system retrying a stale one. Steps 3-4 deliberately precede
 *     the claim because the immutability trigger (0133) forbids moving a claimed row to CANCELLED.
 */
export async function confirmPendingAction(
  supabase: SupabaseClient,
  userId: string,
  pendingActionId: string,
  opts: { viaPhrase?: boolean } = {},
): Promise<ConfirmResult> {
  const { data: row } = await supabase
    .from("assistant_pending_actions")
    .select("id, action_name, payload, payload_hash, status, expires_at")
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row || row.status !== "PENDING") return { ok: false, error: NOT_CONFIRMABLE_TEXT };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await auditAssistant(supabase, userId, "EXPIRED", row.action_name, { pending_action_id: row.id });
    return { ok: false, error: NOT_CONFIRMABLE_TEXT };
  }

  const action = getAction(row.action_name);
  const executor = WRITE_EXECUTORS[row.action_name];
  if (!action || !executor) {
    console.error("[assistant] confirmPendingAction: unknown action_name", row.action_name);
    return { ok: false, error: "نوع عملیات نامعتبر است." };
  }

  if (opts.viaPhrase && !isConfirmableByPhrase(action.riskLevel)) {
    return { ok: false, error: PHRASE_NOT_ALLOWED_TEXT };
  }

  if (!verifyPayloadHash(row.payload, userId, row.action_name, row.payload_hash)) {
    await cancelRow(supabase, userId, row.id);
    await auditAssistant(supabase, userId, "PAYLOAD_TAMPERED", row.action_name, { pending_action_id: row.id });
    return { ok: false, error: "این درخواست معتبر نیست و لغو شد. لطفاً دوباره درخواست بدهید." };
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile || !(profile as Profile).is_active || !hasAccess(profile as Profile, action.requiredAccess)) {
    await cancelRow(supabase, userId, row.id);
    await auditAssistant(supabase, userId, "PERMISSION_DENIED", row.action_name, { pending_action_id: row.id, stage: "CONFIRM" });
    return { ok: false, error: "دسترسی شما برای انجام این عملیات دیگر معتبر نیست و درخواست لغو شد." };
  }

  const { data: claimed, error: claimErr } = await supabase
    .from("assistant_pending_actions")
    .update({ status: "CONFIRMED", resolved_at: new Date().toISOString() })
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .gt("expires_at", new Date().toISOString())
    .select("action_name, payload")
    .single();
  if (claimErr || !claimed) return { ok: false, error: NOT_CONFIRMABLE_TEXT };

  let result: { data: { id: string } } | { error: string };
  try {
    result = await executor(claimed.payload as Record<string, unknown>, supabase, userId);
  } catch (err) {
    console.error("[assistant] executor threw", claimed.action_name, err);
    await supabase.rpc("assistant_write_log", { p_pending_action_id: pendingActionId, p_action_name: claimed.action_name, p_result: "FAILED" });
    await auditAssistant(supabase, userId, "FAILED", claimed.action_name, { pending_action_id: pendingActionId });
    return { ok: false, error: "انجام عملیات با خطا مواجه شد و چیزی ثبت نشد. لطفاً دوباره درخواست بدهید." };
  }

  const outcome = "error" in result ? "FAILED" : "CONFIRMED";
  await supabase.rpc("assistant_write_log", { p_pending_action_id: pendingActionId, p_action_name: claimed.action_name, p_result: outcome });
  await auditAssistant(supabase, userId, outcome, claimed.action_name, {
    pending_action_id: pendingActionId,
    ...("data" in result ? { result_id: result.data.id } : {}),
  });

  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, resultId: result.data.id, actionName: claimed.action_name };
}

async function cancelRow(supabase: SupabaseClient, userId: string, pendingActionId: string): Promise<void> {
  await supabase
    .from("assistant_pending_actions")
    .update({ status: "CANCELLED", resolved_at: new Date().toISOString() })
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .eq("status", "PENDING");
}

export async function cancelPendingAction(supabase: SupabaseClient, userId: string, pendingActionId: string): Promise<{ ok: boolean }> {
  const { data } = await supabase
    .from("assistant_pending_actions")
    .update({ status: "CANCELLED", resolved_at: new Date().toISOString() })
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .select("id, action_name")
    .single();
  if (data) {
    await supabase.rpc("assistant_write_log", { p_pending_action_id: pendingActionId, p_action_name: "CANCEL", p_result: "CANCELLED" });
    await auditAssistant(supabase, userId, "CANCELLED", data.action_name, { pending_action_id: pendingActionId });
  }
  return { ok: !!data };
}

/**
 * Deterministic confirmation-by-plain-text (spec §19): a bare "باشه" is
 * only ever treated as confirmation when exactly one PENDING action
 * exists for this user — never guessed, never resolved by the LLM — and
 * (spec §40) only for LOW/MEDIUM risk: confirmPendingAction({viaPhrase})
 * refuses HIGH/CRITICAL, which need the explicit confirm button.
 */
const AFFIRMATIVE_PHRASES = new Set(["باشه", "بله", "تایید", "تأیید", "اوکی", "ok", "yes", "بزن", "انجام بده", "ثبت کن", "ثبت شود"]);

export function isAffirmativePhrase(text: string): boolean {
  return AFFIRMATIVE_PHRASES.has(text.trim().toLowerCase());
}

export async function findSinglePendingAction(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ id: string; preview_text: string; action_name: string } | null> {
  const { data } = await supabase
    .from("assistant_pending_actions")
    .select("id, preview_text, action_name")
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .gt("expires_at", new Date().toISOString());
  if (!data || data.length !== 1) return null;
  return data[0];
}

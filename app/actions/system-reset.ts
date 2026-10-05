"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { persianError } from "@/lib/enums";
import { currentJalaliYear } from "@/lib/jalali";
import { currentResetGuard } from "@/lib/system-reset/env";
import { expectedPhrase } from "@/lib/system-reset/phrases";
import { armSchema, cancelSchema, dryRunSchema, executeSchema, runSchema, NUMBERING_SCOPES } from "@/lib/system-reset/schemas";
import { buildResetReport } from "@/lib/system-reset/report";
import { STORAGE_BUCKET, splitRemovable } from "@/lib/system-reset/storage";
import type { ResetActionState, ResetIntegrity, ResetPlanResult, ResetRunRow } from "@/lib/system-reset/types";

/**
 * Factory Reset — server actions. The user's session is used ONLY to learn who is calling; every privileged step goes through the
 * service client into the system_reset_* RPCs (granted to service_role only), and every RPC re-checks the permission itself.
 * The browser sends: mode, numbering baselines, confirmation text, plan / run ids. Never table names, SQL or storage paths.
 */

type Svc = ReturnType<typeof createServiceClient>;

async function requireResetUser(): Promise<{ ok: true; userId: string; svc: Svc } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: persianError("NOT_AUTHORIZED") };
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("system_reset_has_permission", { p_user: user.id });
  if (error || data !== true) return { ok: false, error: persianError("NOT_AUTHORIZED") };
  return { ok: true, userId: user.id, svc };
}

const entries = (f: FormData) => Object.fromEntries(f.entries());

function toIso(v: FormDataEntryValue | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function baselinesFrom(raw: Record<string, FormDataEntryValue>) {
  return Object.fromEntries(NUMBERING_SCOPES.map((s) => [s, raw[`baseline_${s}`]]));
}

/* ----------------------------- 1) dry run ----------------------------- */

export async function createResetDryRun(_p: ResetActionState, f: FormData): Promise<ResetActionState> {
  const raw = entries(f);
  const parsed = dryRunSchema.safeParse({ mode: raw.mode, baselines: baselinesFrom(raw) });
  if (!parsed.success) return { error: "ورودی نامعتبر است (حالت یا مقادیر شمارنده‌ها را بررسی کنید)." };
  const who = await requireResetUser();
  if (!who.ok) return { error: who.error };
  const { env, allowProduction } = currentResetGuard();

  const { data, error } = await who.svc.rpc("system_reset_dry_run", {
    p_user: who.userId,
    p_mode: parsed.data.mode,
    p_params: { current_year: currentJalaliYear(), baselines: parsed.data.baselines },
    p_environment: env,
    p_allow_production: allowProduction,
  });
  if (error) return { error: persianError(error.message) };
  return { plan: data as ResetPlanResult };
}

export async function cancelResetPlan(_p: ResetActionState, f: FormData): Promise<ResetActionState> {
  const parsed = cancelSchema.safeParse(entries(f));
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const who = await requireResetUser();
  if (!who.ok) return { error: who.error };
  const { error } = await who.svc.rpc("system_reset_cancel_plan", { p_user: who.userId, p_plan: parsed.data.plan_id });
  if (error) return { error: persianError(error.message) };
  return { cancelled: parsed.data.plan_id };
}

/* ------------- 2) arm: backup attestation + typed phrase + second confirmation -> one-time token ------------- */

export async function armReset(_p: ResetActionState, f: FormData): Promise<ResetActionState> {
  const raw = entries(f);
  const parsed = armSchema.safeParse({
    plan_id: raw.plan_id,
    phrase: raw.phrase,
    second_confirm: raw.second_confirm === "on" || raw.second_confirm === "true",
    backup_reference: raw.backup_reference,
    backup_timestamp: toIso(raw.backup_timestamp),
    backup_status: raw.backup_confirmed === "on" || raw.backup_confirmed === "true" ? "CONFIRMED_BY_ADMIN" : undefined,
  });
  if (!parsed.success) return { error: "اطلاعات تأیید ناقص است: مرجع بکاپ، زمان بکاپ، تأیید بکاپ و تأیید دوم الزامی است." };
  const who = await requireResetUser();
  if (!who.ok) return { error: who.error };
  const { env, allowProduction } = currentResetGuard();

  // early, friendlier phrase check; the database enforces the same phrase again
  if (parsed.data.phrase.trim() !== expectedPhrase("OPERATIONAL", env)) return { error: persianError("RESET_CONFIRMATION_INVALID") };

  const { data, error } = await who.svc.rpc("system_reset_arm", {
    p_user: who.userId,
    p_plan: parsed.data.plan_id,
    p_phrase: parsed.data.phrase.trim(),
    p_second_confirm: true,
    p_backup_reference: parsed.data.backup_reference,
    p_backup_timestamp: parsed.data.backup_timestamp,
    p_backup_status: parsed.data.backup_status,
    p_environment: env,
    p_allow_production: allowProduction,
  });
  if (error) return { error: persianError(error.message) };
  return { armed: { plan_id: parsed.data.plan_id, token: data as string } };
}

/* ------------------------------ 3) execute ------------------------------ */

async function fetchRun(svc: Svc, runId: string): Promise<ResetRunRow | null> {
  const { data } = await svc.from("system_reset_runs").select("*").eq("id", runId).maybeSingle();
  return (data as ResetRunRow | null) ?? null;
}

async function cleanupStorage(svc: Svc, userId: string, runId: string): Promise<void> {
  for (;;) {
    const { data, error } = await svc.rpc("system_reset_storage_pending", { p_user: userId, p_run: runId, p_limit: 100 });
    if (error) throw new Error(error.message);
    const list = (data ?? []) as string[];
    if (list.length === 0) break;
    const { removable, refused } = splitRemovable(list);
    if (refused.length > 0) {
      await svc.rpc("system_reset_storage_mark", { p_user: userId, p_run: runId, p_paths: refused, p_error: "UNSAFE_PATH" });
    }
    if (removable.length > 0) {
      const { error: rmErr } = await svc.storage.from(STORAGE_BUCKET).remove(removable);
      await svc.rpc("system_reset_storage_mark", {
        p_user: userId, p_run: runId, p_paths: removable, p_error: rmErr ? "STORAGE_REMOVE_FAILED" : null,
      });
    }
  }
  const { error } = await svc.rpc("system_reset_storage_complete", { p_user: userId, p_run: runId });
  if (error) throw new Error(error.message);
}

/** After the DB part is done: storage cleanup -> orphan scan -> integrity verification -> final report. Safe to call again (resume). */
async function finishRun(svc: Svc, userId: string, runId: string, planParams: { current_year: number; baselines: Record<string, number> }): Promise<ResetActionState> {
  await cleanupStorage(svc, userId, runId);

  const scanRes = await svc.rpc("system_reset_storage_scan");
  const scan = (scanRes.data ?? { delete_remaining: 0, preserved: 0, unknown: 0, unknown_sample: [] }) as {
    delete_remaining: number; preserved: number; unknown: number; unknown_sample: string[];
  };
  const { data: integ, error: integErr } = await svc.rpc("system_reset_verify", { p_user: userId, p_run: runId });
  if (integErr) throw new Error(integErr.message);
  const integrity = integ as ResetIntegrity;
  integrity.checks.push({ key: "NO_ORPHAN_BUSINESS_FILES", ok: scan.delete_remaining === 0, detail: { remaining: scan.delete_remaining } });
  integrity.ok = integrity.checks.every((c) => c.ok);

  const run = await fetchRun(svc, runId);
  if (!run) throw new Error("RESET_PLAN_INVALID");
  const warnings: string[] = [];
  if (scan.unknown > 0) warnings.push("UNKNOWN_STORAGE_OBJECTS_KEPT");
  const report = buildResetReport(run, planParams, integrity.checks, scan, warnings);
  const { error: finErr } = await svc.rpc("system_reset_finish", { p_user: userId, p_run: runId, p_integrity: integrity, p_report: report });
  if (finErr) throw new Error(finErr.message);
  revalidatePath("/settings/system/factory-reset");
  return { done: { run_id: runId, status: report.final_status, integrity, report } };
}

export async function executeReset(_p: ResetActionState, f: FormData): Promise<ResetActionState> {
  const parsed = executeSchema.safeParse(entries(f));
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const who = await requireResetUser();
  if (!who.ok) return { error: who.error };
  const { env, allowProduction, guard } = currentResetGuard();
  if (!guard.allowed) return { error: persianError("RESET_PRODUCTION_BLOCKED") };

  // the plan the DB will execute is the one that was reviewed; its parameters are read back from the stored plan
  const { data: plan } = await who.svc.from("system_reset_plans").select("params").eq("id", parsed.data.plan_id).maybeSingle();
  const planParams = (plan?.params ?? { current_year: currentJalaliYear(), baselines: {} }) as { current_year: number; baselines: Record<string, number> };

  // step 8: server-side permission + plan + token revalidation, one-shot claim, maintenance lock ON
  const begin = await who.svc.rpc("system_reset_begin", {
    p_user: who.userId, p_plan: parsed.data.plan_id, p_token: parsed.data.token, p_environment: env, p_allow_production: allowProduction,
  });
  if (begin.error) return { error: persianError(begin.error.message) };
  const runId = begin.data as string;

  let phase = "DB_RESET_STARTED";
  try {
    // step 9: the destructive DB phase — a single transaction inside the database
    const db = await who.svc.rpc("system_reset_execute_db", { p_user: who.userId, p_run: runId, p_environment: env, p_allow_production: allowProduction });
    if (db.error) throw new Error(db.error.message);
    phase = "STORAGE_CLEANUP_STARTED";
    // step 10: storage cleanup, orphan scan, integrity verification
    return await finishRun(who.svc, who.userId, runId, planParams);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN";
    await who.svc.rpc("system_reset_fail", { p_user: who.userId, p_run: runId, p_phase: phase, p_error: message });
    return { error: persianError(message), run_id: runId };
  }
}

/** Continues ONLY the pending / failed storage items of a run whose DB part is already complete. It never re-runs the DB reset. */
export async function resumeStorageCleanup(_p: ResetActionState, f: FormData): Promise<ResetActionState> {
  const parsed = runSchema.safeParse(entries(f));
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const who = await requireResetUser();
  if (!who.ok) return { error: who.error };
  const run = await fetchRun(who.svc, parsed.data.run_id);
  if (!run || run.initiated_by !== who.userId || !run.counts_before || !["STORAGE_CLEANUP_STARTED", "STORAGE_CLEANUP_COMPLETED", "VERIFICATION", "FAILED"].includes(run.phase) || run.status === "COMPLETED") {
    return { error: persianError("RESET_PLAN_INVALID") };
  }
  const { data: plan } = await who.svc.from("system_reset_plans").select("params").eq("id", run.plan_id).maybeSingle();
  const planParams = (plan?.params ?? { current_year: currentJalaliYear(), baselines: {} }) as { current_year: number; baselines: Record<string, number> };
  try {
    await who.svc.rpc("system_reset_storage_retry", { p_user: who.userId, p_run: run.id });
    return await finishRun(who.svc, who.userId, run.id, planParams);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN";
    await who.svc.rpc("system_reset_fail", { p_user: who.userId, p_run: run.id, p_phase: "STORAGE_CLEANUP_STARTED", p_error: message });
    return { error: persianError(message), run_id: run.id };
  }
}

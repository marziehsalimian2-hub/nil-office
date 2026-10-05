import type { IntegrityCheck, ResetReport, ResetRunRow } from "./types";

/**
 * Technical reset report (spec §47). Built from the run row (counts recorded by the database), the plan parameters and the final
 * integrity checks. It carries counts, ids and codes only — never credentials, never row contents.
 */
export function buildResetReport(
  run: Pick<ResetRunRow, "id" | "mode" | "environment" | "backup_reference" | "manifest_version" | "started_at" | "completed_at" | "counts_before" | "counts_deleted" | "storage_cleanup">,
  params: { current_year: number; baselines: Record<string, number> },
  integrity: IntegrityCheck[],
  scan: { preserved: number; unknown: number; unknown_sample: string[]; delete_remaining: number },
  warnings: string[],
): ResetReport {
  const deleted = run.counts_deleted ?? {};
  const byTable: Record<string, number> = {};
  let rows = 0;
  for (const [k, v] of Object.entries(deleted)) {
    if (k.startsWith("_")) continue;
    byTable[k] = v;
    rows += v;
  }
  const preserved: Record<string, number> = {};
  for (const [k, v] of Object.entries(run.counts_before ?? {})) {
    if (k.startsWith("preserve:")) preserved[k.slice("preserve:".length)] = v;
  }
  const ok = integrity.every((c) => c.ok);
  return {
    reset_id: run.id,
    mode: run.mode,
    environment: run.environment,
    backup_reference: run.backup_reference,
    manifest_version: run.manifest_version,
    started_at: run.started_at,
    completed_at: run.completed_at,
    tables_affected: Object.keys(byTable).length,
    rows_deleted: rows,
    rows_deleted_by_table: byTable,
    rows_preserved: preserved,
    audit_rows_deleted: deleted._audit_rows ?? 0,
    sequences: params,
    files: {
      deleted: run.storage_cleanup?.done ?? 0,
      failed: run.storage_cleanup?.failed ?? 0,
      preserved: scan.preserved,
      unknown: scan.unknown,
      unknown_sample: scan.unknown_sample,
    },
    warnings,
    integrity,
    final_status: ok ? "COMPLETED" : "FAILED",
  };
}

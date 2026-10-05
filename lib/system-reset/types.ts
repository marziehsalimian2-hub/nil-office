/** Shapes returned by the system_reset_* RPCs (migration 0141). Counts are numbers; nothing here is a secret. */
export type ResetMode = "OPERATIONAL" | "FULL";

export type ResetTableRow = {
  name: string; module: string; rows: number | null; method: string; risk: "LOW" | "MEDIUM" | "HIGH"; storage: string; sequence: string;
};
export type ResetPreservedRow = { name: string; module: string; rows: number | null; method: string; reason: string };

export type ResetPreview = {
  mode: ResetMode;
  manifest_version: number;
  manifest_hash: string;
  schema_hash: string;
  params: { current_year: number; baselines: Record<string, number> };
  tables_to_delete: ResetTableRow[];
  tables_preserved: ResetPreservedRow[];
  totals: { tables: number; rows_to_delete: number; audit_rows_to_delete: number; storage_objects_to_delete: number };
  templates: { global_kept: number; client_scope_removed: number };
  audit: { rows_to_delete: number; rows_kept: number; unclassified_entity_types: string[]; deleted_entity_types: string[] };
  sequences: {
    number_sequences: { scope: string; year: number; from: number; to: number }[];
    rows_to_create: { scope: string; year: number; to: number }[];
    accounting_sequences: { rows: number; sum_last_value: number };
  };
  storage: { delete_count: number; preserve_count: number; unknown_count: number; unknown_sample: string[] };
  unknown_tables: string[];
  missing_manifest_objects: string[];
  fk_blockers: { referencing: string; referenced: string; constraint: string }[];
  orphan_risks: { attachments_without_file: number; business_files_without_record: number; unknown_storage_objects: number };
  admins_preserved: { count: number; profile_ids: string[] };
  warnings: string[];
  executable: boolean;
};

export type ResetPlanResult = { plan_id: string; expires_at: string; preview: ResetPreview };

export type IntegrityCheck = { key: string; ok: boolean; detail?: unknown };
export type ResetIntegrity = { ok: boolean; checks: IntegrityCheck[] };

export type ResetRunRow = {
  id: string; plan_id: string; mode: string; environment: string; initiated_by: string | null; started_at: string; completed_at: string | null;
  status: "PLANNED" | "READY" | "RUNNING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
  phase: string; backup_reference: string | null; manifest_version: number;
  counts_before: Record<string, number> | null; counts_deleted: Record<string, number> | null;
  storage_cleanup: { total: number; done: number; pending: number; failed: number } | null;
  integrity_result: ResetIntegrity | null; report: ResetReport | null; error: string | null;
};

export type ResetReport = {
  reset_id: string;
  mode: string;
  environment: string;
  backup_reference: string | null;
  manifest_version: number;
  started_at: string;
  completed_at: string | null;
  tables_affected: number;
  rows_deleted: number;
  rows_deleted_by_table: Record<string, number>;
  rows_preserved: Record<string, number>;
  audit_rows_deleted: number;
  sequences: { current_year: number; baselines: Record<string, number> };
  files: { deleted: number; failed: number; preserved: number; unknown: number; unknown_sample: string[] };
  warnings: string[];
  integrity: IntegrityCheck[];
  final_status: "COMPLETED" | "FAILED";
};

/** Result of a server action; the panel renders whichever part is present. */
export type ResetActionState =
  | null
  | { error: string; run_id?: string }
  | { plan: ResetPlanResult }
  | { cancelled: string }
  | { armed: { plan_id: string; token: string } }
  | { done: { run_id: string; status: string; integrity: ResetIntegrity; report: ResetReport } };

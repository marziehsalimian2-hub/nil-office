import type { PayrollWarning } from "@/lib/payroll/warnings";

/** Shapes returned by the read RPCs (0122). EVERY amount is a decimal string — never parse it with Number(). */

export type ReviewBatch = {
  id: string; batch_number: string; status: string; currency: string; jurisdiction: string | null;
  rounding_scale: number; rounding_mode: string; calculation_version: number;
  calculated_at: string | null; calculated_by: string | null; submitted_at: string | null;
  reviewed_at: string | null; reviewed_by: string | null; status_note: string | null; notes: string | null;
  submitted_by: string | null; approved_at: string | null; approved_by: string | null;
  accounting_journal_entry_id: string | null;
};

export type ReviewResult = {
  result_id: string; personnel_id: string; personnel_number: string; personnel_name: string; currency: string | null;
  gross: string; deductions: string; employer_cost: string; net: string;
  is_complete: boolean; critical_count: number; warning_count: number;
  prev_gross: string | null; prev_net: string | null; is_new: boolean;
  net_change_pct: string | null; large_change: boolean;
};

export type ReviewOverride = {
  personnel_id: string; personnel_number: string; personnel_name: string;
  decision: string; reason: string | null; decided_at: string;
};

export type PayrollReview = {
  batch: ReviewBatch;
  period: { id: string; jalali_year: number; jalali_month: number; period_start: string; period_end: string };
  previous_period: { jalali_year: number; jalali_month: number } | null;
  stale: string[];
  approval_blockers: string[];
  /** Segregation of duties is RECORDED, not enforced — the UI shows these as warnings. */
  sod: { reviewer_is_submitter: boolean; approver_is_submitter: boolean; approver_is_reviewer: boolean };
  totals: { personnel_count: number; gross: string; deductions: string; employer_cost: string; net: string };
  critical_count: number;
  warning_count: number;
  results: ReviewResult[];
  warnings: PayrollWarning[];
  overrides: ReviewOverride[];
};

export type ResultLine = {
  line_order: number; component_code: string; component_name_fa: string; component_type: string;
  method: string; status: "COMPUTED" | "NOT_COMPUTED"; amount: string | null; amount_source: string | null;
  basis: string | null; base_amount: string | null; rate: string | null; rate_source: string | null;
  rule_key: string | null; rule_set_label: string | null; taxable: boolean; insurable: boolean;
};

export type ResultDetail = {
  result: {
    id: string; batch_id: string; calculation_id: string; personnel_id: string; personnel_number: string;
    personnel_name: string; currency: string | null; gross: string; total_deductions: string; employer_cost: string;
    net: string; is_complete: boolean; compensation_version_number: number | null;
    inputs: Record<string, unknown>; calculation_version: number; is_current: boolean;
  };
  lines: ResultLine[];
  warnings: PayrollWarning[];
};

export type WorkGridRow = {
  personnel_id: string; personnel_number: string; name: string; job_title: string;
  in_period: boolean; included: boolean; override: string | null; currency: string | null;
  has_profile: boolean; partial_period: boolean; locked: boolean;
  manual_components: { component_id: string; code: string; name_fa: string }[];
  work_data: {
    id: string; revision: number; work_days: string | null; work_hours: string | null; overtime_hours: string | null;
    absence_days: string | null; absence_hours: string | null; paid_leave_days: string | null;
    unpaid_leave_days: string | null; mission_days: string | null; mission_hours: string | null; notes: string | null;
  } | null;
  inputs: Record<string, { amount: string; currency: string }>;
};

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

export function sortWarnings<T extends { severity: string; code: string }>(ws: T[]): T[] {
  return [...ws].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.code.localeCompare(b.code),
  );
}

/** Person-level warnings keyed by personnel_id; batch-level ones (personnel_id null) under "". */
export function groupWarningsByPersonnel(ws: PayrollWarning[]): Map<string, PayrollWarning[]> {
  const m = new Map<string, PayrollWarning[]>();
  for (const w of ws) {
    const key = w.personnel_id ?? "";
    const list = m.get(key);
    if (list) list.push(w);
    else m.set(key, [w]);
  }
  for (const [k, v] of m) m.set(k, sortWarnings(v));
  return m;
}

/** Form pre-fill ONLY: the user still confirms rounding explicitly on batch creation. */
export function defaultRounding(currency: string | null | undefined): { scale: number; mode: "HALF_UP" } {
  return currency === "IRR" || currency === "TOMAN" ? { scale: 0, mode: "HALF_UP" } : { scale: 2, mode: "HALF_UP" };
}

/** True when a batch can be sent for review: calculated, fresh, and zero CRITICAL warnings is NOT required here (blocking is the approval phase). */
export function canSubmitForReview(status: string, stale: string[]): boolean {
  return status === "CALCULATED" && stale.length === 0;
}

export type AccountingReadiness = {
  base_currency: string;
  currency_ok: boolean;
  settings_ok: boolean;
  missing_components: { code: string; name: string }[];
  journal: { id: string; status: string; document_number: string | null } | null;
  can_draft: boolean;
};

export type AccountOption = { id: string; code: string; name: string; account_type: string; nature: string };

/** UI gating only — approve_payroll_batch re-checks everything server-side. */
export function canApproveBatch(status: string, blockers: string[]): boolean {
  return status === "UNDER_REVIEW" && blockers.length === 0;
}

/** Reasons the accounting draft button cannot work yet (readiness is computed by the DB; this only orders the message). */
export function accountingBlockers(r: AccountingReadiness): string[] {
  const out: string[] = [];
  if (!r.currency_ok) out.push("CURRENCY_NOT_BASE");
  if (!r.settings_ok) out.push("SETTINGS_MISSING");
  if (r.missing_components.length > 0) out.push("COMPONENTS_UNMAPPED");
  return out;
}

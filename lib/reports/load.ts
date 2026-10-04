import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportDef } from "@/lib/reports/definitions";
import { rpcArgs, missingFilters, type ReportParams } from "@/lib/reports/params";
import { withPeriodLabel, type ReportRow } from "@/lib/reports/format";

export const PAGE_LIMIT = 500;
export const EXPORT_LIMIT = 20000;

export type LoadedReport = {
  rows: ReportRow[];
  totals: ReportRow[];
  truncated: boolean;
  missing: string[];   // required filters not chosen yet
  error?: string;
};

/**
 * Loads a report through the CALLER's own session. Payroll reports go through gated definer RPCs (amounts as text);
 * HR reports are plain RLS reads of personnel / employment_records (no amounts exist there).
 */
export async function loadReport(supabase: SupabaseClient, def: ReportDef, params: ReportParams, limit: number): Promise<LoadedReport> {
  const missing = missingFilters(def, params);
  if (missing.length > 0) return { rows: [], totals: [], truncated: false, missing };

  if (def.source.kind === "rpc") {
    const { data, error } = await supabase.rpc(def.source.name, rpcArgs(def, params));
    if (error) return { rows: [], totals: [], truncated: false, missing: [], error: error.message };
    const d = (data ?? {}) as { rows?: ReportRow[]; totals?: ReportRow[] };
    const all = (d.rows ?? []).map(withPeriodLabel);
    return { rows: all.slice(0, limit), totals: d.totals ?? [], truncated: all.length > limit, missing: [] };
  }

  if (def.source.name === "personnel") {
    let q = supabase
      .from("personnel")
      .select("personnel_number, first_name, last_name, job_title, department, employment_type, employment_status, hire_date, termination_date, work_location")
      .order("personnel_number")
      .limit(limit + 1);
    if (def.key === "hr_active_personnel") q = q.eq("employment_status", "ACTIVE");
    else if (params.status) q = q.eq("employment_status", params.status);
    if (params.employment_type) q = q.eq("employment_type", params.employment_type);
    if (params.department) q = q.ilike("department", `%${params.department.replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) return { rows: [], totals: [], truncated: false, missing: [], error: error.message };
    const all = ((data ?? []) as ReportRow[]).map((r) => ({ ...r, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() }));
    return { rows: all.slice(0, limit), totals: [], truncated: all.length > limit, missing: [] };
  }

  // employment_records
  let q = supabase
    .from("employment_records")
    .select("employment_type, job_title, department, start_date, end_date, status, work_schedule_type, personnel:personnel_id(personnel_number, first_name, last_name)")
    .order("start_date", { ascending: false })
    .limit(limit + 1);
  if (params.status) q = q.eq("status", params.status);
  if (params.employment_type) q = q.eq("employment_type", params.employment_type);
  const { data, error } = await q;
  if (error) return { rows: [], totals: [], truncated: false, missing: [], error: error.message };
  type Raw = ReportRow & { personnel: { personnel_number: string; first_name: string; last_name: string } | { personnel_number: string; first_name: string; last_name: string }[] | null };
  const all = ((data ?? []) as Raw[]).map((r): ReportRow => {
    const p = Array.isArray(r.personnel) ? r.personnel[0] : r.personnel;
    return { ...r, personnel_number: p?.personnel_number ?? "", name: p ? `${p.first_name} ${p.last_name}` : "" };
  });
  all.sort((a, b) => String(a.personnel_number).localeCompare(String(b.personnel_number)) || String(b.start_date).localeCompare(String(a.start_date)));
  return { rows: all.slice(0, limit), totals: [], truncated: all.length > limit, missing: [] };
}

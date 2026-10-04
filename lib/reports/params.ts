import type { ReportDef } from "@/lib/reports/definitions";

/** URL query parameters of a report page / CSV request (all optional strings). */
export type ReportParams = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined): v is string => !!v && UUID.test(v);

/** «1405-07» -> {year:1405, month:7}; anything else -> null. */
export function parseYm(v: string | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(v ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 && year >= 1300 && year <= 1500 ? { year, month } : null;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Which required filters are still missing (the report must not run — and never guesses). */
export function missingFilters(def: ReportDef, p: ReportParams): string[] {
  return (def.required ?? []).filter((k) => {
    if (k === "period") return !isUuid(p.period);
    if (k === "personnel") return !isUuid(p.personnel);
    return !clean(p[k]);
  });
}

/** Arguments for the payroll read RPC behind a report. Pure, so the mapping is unit-tested. */
export function rpcArgs(def: ReportDef, p: ReportParams): Record<string, unknown> {
  if (def.source.kind !== "rpc") return {};
  const from = parseYm(p.from);
  const to = parseYm(p.to);
  const currency = clean(p.currency);
  const period = isUuid(p.period) ? p.period : null;
  const personnel = isUuid(p.personnel) ? p.personnel : null;
  const fixed = def.source.fixed ?? {};
  switch (def.source.name) {
    case "payroll_report_register":
    case "payroll_report_components":
      return { p_period_id: period, p_currency: currency };
    case "payroll_report_by_period":
      return { p_from_year: from?.year ?? null, p_from_month: from?.month ?? null, p_to_year: to?.year ?? null, p_to_month: to?.month ?? null, p_currency: currency };
    case "payroll_report_by_personnel":
      return { p_personnel_id: personnel, p_from_year: from?.year ?? null, p_from_month: from?.month ?? null, p_to_year: to?.year ?? null, p_to_month: to?.month ?? null };
    case "payroll_report_payments":
      return { p_period_id: period, p_currency: currency, p_only_outstanding: false, ...fixed };
    case "payroll_report_reconciliation":
    case "payroll_report_payslips":
      return { p_period_id: period };
    case "payroll_report_compensation_history":
      return { p_personnel_id: personnel };
    default:
      return { ...fixed };
  }
}

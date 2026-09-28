/**
 * Server-authoritative period resolution for the Client Service Ledger's
 * Executive Summary / Portfolio Dashboard (spec §24) — mirrors
 * lib/assistant/dates.ts's "the server computes it, never trust a
 * client-supplied value" philosophy, but for named periods instead of
 * relative phrases. Plain (no "server-only") since it's pure date math —
 * usable from both the period-filter UI (to build the right query
 * string) and the Server Components that read it back.
 */
export const PERIOD_PRESETS = ["this_month", "prev_month", "quarter", "year", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type ResolvedPeriod = { start: string; end: string; label: string };

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  this_month: "این ماه",
  prev_month: "ماه قبل",
  quarter: "فصل جاری",
  year: "سال جاری",
  custom: "بازهٔ دلخواه",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toIso(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Resolves a named period (or a validated custom range) to concrete ISO
 * date bounds, computed from the SERVER's own clock — a `period` value
 * the UI can't manipulate into an arbitrary range without also supplying
 * valid `from`/`to` ISO dates for the `custom` case (validated here,
 * not trusted as-is).
 */
export function resolvePeriod(period: string, from?: string | null, to?: string | null): ResolvedPeriod {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12

  switch (period) {
    case "prev_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { start: toIso(py, pm, 1), end: toIso(py, pm, lastDayOfMonth(py, pm)), label: PERIOD_LABEL.prev_month };
    }
    case "quarter": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const qEndMonth = qStartMonth + 2;
      return { start: toIso(y, qStartMonth, 1), end: toIso(y, qEndMonth, lastDayOfMonth(y, qEndMonth)), label: PERIOD_LABEL.quarter };
    }
    case "year":
      return { start: toIso(y, 1, 1), end: toIso(y, 12, 31), label: PERIOD_LABEL.year };
    case "custom": {
      const isValidIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (isValidIso(from) && isValidIso(to) && from <= to) {
        return { start: from, end: to, label: PERIOD_LABEL.custom };
      }
      // Invalid/missing custom range — fall back to this_month rather than an unbounded query.
      return { start: toIso(y, m, 1), end: toIso(y, m, lastDayOfMonth(y, m)), label: PERIOD_LABEL.this_month };
    }
    case "this_month":
    default:
      return { start: toIso(y, m, 1), end: toIso(y, m, lastDayOfMonth(y, m)), label: PERIOD_LABEL.this_month };
  }
}

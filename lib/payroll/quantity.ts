import { toFaDigits } from "@/lib/jalali";
import {
  QUANTITY_SOURCE_LABEL, QUANTITY_UNIT_LABEL, quantityUnitOf, CURRENCY_LABEL,
  type QuantitySource, type Currency,
} from "@/lib/enums";
import { formatExactAmount } from "@/lib/payroll/format";

/**
 * Display helpers for QUANTITY_X_RATE components and result lines (Phase 8). Pure — no arithmetic on money:
 * everything shown here is either a stored parameter or an exact decimal STRING computed by the database.
 */

const trimDecimal = (v: string | number): string => {
  const s = String(v);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};
const fa = (v: string | number) => toFaDigits(trimDecimal(v)).replace(/\./g, "٫");

export type QuantityVersionLike = {
  calculation_method: string;
  quantity_source?: string | null;
  rate_mode?: string | null;
  fixed_amount?: number | string | null;
  currency?: string | null;
  unit_divisor?: number | string | null;
  divisor_rule_key?: string | null;
  rate_multiplier?: number | string | null;
  multiplier_rule_key?: string | null;
};

/** One-sentence description of how a QUANTITY_X_RATE version computes its amount — shown on the component page. */
export function describeQuantityVersion(v: QuantityVersionLike): string | null {
  if (v.calculation_method !== "QUANTITY_X_RATE") return null;
  if (!v.quantity_source || !v.rate_mode) return "تعریف قدیمی بدون پارامتر — محاسبه نمی‌شود؛ نسخهٔ جدید ثبت کنید";
  const src = v.quantity_source as QuantitySource;
  const label = QUANTITY_SOURCE_LABEL[src] ?? v.quantity_source;
  if (v.rate_mode === "PER_UNIT") {
    const cur = v.currency ? CURRENCY_LABEL[v.currency as Currency] ?? v.currency : "";
    return `${label} × نرخ ثابت ${v.fixed_amount != null ? formatExactAmount(String(v.fixed_amount)) : "—"} ${cur} برای هر ${QUANTITY_UNIT_LABEL[quantityUnitOf(src)]}`.trim();
  }
  const divisor = v.unit_divisor != null ? fa(v.unit_divisor) : `قاعدهٔ «${v.divisor_rule_key}»`;
  const mult = v.rate_multiplier != null ? fa(v.rate_multiplier) : `قاعدهٔ «${v.multiplier_rule_key}»`;
  return `${label} × (دستمزد ÷ ${divisor} × ${mult})`;
}

/** «۱۰ ساعت × ۱۹۰٬۹۰۹» — the quantity part shown next to a payslip / result line (exact strings from the database). */
export function describeQuantityLine(q: { quantity?: string | null; unit?: string | null; unit_rate?: string | null }, currency?: string | null): string | null {
  if (q.quantity == null || !q.unit) return null;
  const unitLabel = QUANTITY_UNIT_LABEL[q.unit as "HOURS" | "DAYS"] ?? "";
  const rate = q.unit_rate != null ? ` × ${formatExactAmount(roundRate(q.unit_rate), currency)}` : "";
  return `${fa(q.quantity)} ${unitLabel}${rate}`;
}

/** The unit rate arrives with 6 decimals; for display keep at most 2 (string truncation of a value that is informational only — the line amount is the authoritative number). */
export function roundRate(v: string): string {
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return v;
  const frac = (m[2] ?? "").slice(0, 2).replace(/0+$/, "");
  return frac ? `${m[1]}.${frac}` : m[1];
}

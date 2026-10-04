import { formatMoney } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";
import { CURRENCY_LABEL, type Currency } from "@/lib/enums";

const currencyLabel = (currency: string | null | undefined) =>
  currency ? (CURRENCY_LABEL[currency as Currency] ?? currency) : "";

/** formatMoney's DisplayUnit only knows Rial/Toman, so the currency label is appended explicitly (never mixed across currencies). */
export function formatCurrencyAmount(value: number | string | null | undefined, currency: string | null | undefined): string {
  return `${formatMoney(value)} ${currencyLabel(currency)}`.trim();
}

/**
 * Exact amount formatting for values that arrive from the calculation RPCs as decimal STRINGS
 * (numeric(20,4)::text). Pure string grouping — no Number(), so nothing past 2^53 loses a digit.
 * Trailing fractional zeros are trimmed ("9020501.0000" -> "9,020,501"). Invalid input -> "—".
 */
export function formatExactAmount(value: string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(value)) return "—";
  const neg = value.startsWith("-");
  const [intPart, fracRaw = ""] = (neg ? value.slice(1) : value).split(".");
  const frac = fracRaw.replace(/0+$/, "");
  const intNorm = intPart.replace(/^0+(?=\d)/, "");
  const grouped = intNorm.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const isZero = /^0*$/.test(intNorm) && frac === "";
  const body = frac ? `${grouped}.${frac}` : grouped;
  const fa = toFaDigits(`${neg && !isZero ? "-" : ""}${body}`).replace(/,/g, "٬").replace(/\./g, "٫");
  const label = currencyLabel(currency);
  return label ? `${fa} ${label}` : fa;
}

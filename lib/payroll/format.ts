import { formatMoney } from "@/lib/money";
import { CURRENCY_LABEL, type Currency } from "@/lib/enums";

/** formatMoney's DisplayUnit only knows Rial/Toman, so the currency label is appended explicitly (never mixed across currencies). */
export function formatCurrencyAmount(value: number | string | null | undefined, currency: string | null | undefined): string {
  const label = currency ? (CURRENCY_LABEL[currency as Currency] ?? currency) : "";
  return `${formatMoney(value)} ${label}`.trim();
}

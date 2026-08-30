import { toFaDigits } from "@/lib/jalali";

export type DisplayUnit = "RIAL" | "TOMAN";
export const UNIT_LABEL: Record<DisplayUnit, string> = { RIAL: "ریال", TOMAN: "تومان" };

/**
 * Format a stored monetary amount (already in the configured base unit — no
 * silent Rial/Toman conversion) with thousands separators and Persian digits.
 */
export function formatMoney(
  value: number | string | null | undefined,
  unit?: DisplayUnit,
): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (n == null || Number.isNaN(n)) return "—";
  const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
  const fa = toFaDigits(grouped);
  return unit ? `${fa} ${UNIT_LABEL[unit]}` : fa;
}

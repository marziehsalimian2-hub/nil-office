import { toGregorian, toFaDigits } from "@/lib/jalali";

export const JALALI_MONTH_NAMES = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * First and last day (BOTH inclusive) of a Jalali month, as ISO Gregorian dates.
 * Authoritative source of payroll period boundaries — the DB only sanity-checks them.
 */
export function jalaliMonthRange(jy: number, jm: number): { start: string; end: string; days: number } {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || jm < 1 || jm > 12) {
    throw new RangeError("Invalid Jalali year/month");
  }
  const s = toGregorian(jy, jm, 1);
  const ny = jm === 12 ? jy + 1 : jy;
  const nm = jm === 12 ? 1 : jm + 1;
  const n = toGregorian(ny, nm, 1);
  const startMs = Date.UTC(s.gy, s.gm - 1, s.gd);
  const nextMs = Date.UTC(n.gy, n.gm - 1, n.gd);
  const last = new Date(nextMs - 86_400_000);
  return {
    start: iso(s.gy, s.gm, s.gd),
    end: iso(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate()),
    days: Math.round((nextMs - startMs) / 86_400_000),
  };
}

export function jalaliMonthLabel(jy: number, jm: number): string {
  return `${JALALI_MONTH_NAMES[jm - 1] ?? "؟"} ${toFaDigits(jy)}`;
}

export function previousJalaliMonth(jy: number, jm: number): { jy: number; jm: number } {
  return jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
}

/** Negative when a < b. */
export function compareJalaliMonth(a: { jy: number; jm: number }, b: { jy: number; jm: number }): number {
  return a.jy !== b.jy ? a.jy - b.jy : a.jm - b.jm;
}

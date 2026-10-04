import { previousJalaliMonth, jalaliMonthLabel } from "@/lib/payroll/period";

/** One row of assistant_my_payslips().items (0134). `net` is intentionally NOT used here — salary amounts never reach the LLM. */
export type OwnPayslipItem = {
  id: string;
  revision: number;
  payment_state: "NOT_PAID" | "PARTIALLY_PAID" | "PAID";
  issued_at: string;
  jalali_year: number;
  jalali_month: number;
  currency: string;
  is_latest: boolean;
};

export type PayslipRequest = { period?: "latest" | "this_month" | "prev_month"; jalali_year?: number; jalali_month?: number };

export const PAYMENT_STATE_AT_ISSUE_FA: Record<OwnPayslipItem["payment_state"], string> = {
  NOT_PAID: "در زمان صدور: هنوز پرداخت نشده بود",
  PARTIALLY_PAID: "در زمان صدور: پرداخت ناقص بود",
  PAID: "در زمان صدور: پرداخت‌شده بود",
};

export type PayslipSelection = { ok: true; item: OwnPayslipItem; label: string } | { ok: false; error: string };

/**
 * Picks the ONE payslip the user asked for from their own list. Never guesses: an explicit month that has no
 * payslip is reported as missing rather than substituted. When a month has several revisions the latest wins.
 * `today` is the caller's current Jalali year/month (server clock — the model never does calendar math).
 */
export function selectOwnPayslip(items: OwnPayslipItem[], req: PayslipRequest, today: { jy: number; jm: number }): PayslipSelection {
  const latestPerMonth = items.filter((i) => i.is_latest);
  if (latestPerMonth.length === 0) return { ok: false, error: "هنوز هیچ فیش حقوقی‌ای برای شما صادر نشده است." };

  let target: { jy: number; jm: number } | null = null;
  if (req.jalali_year != null || req.jalali_month != null) {
    if (req.jalali_year == null || req.jalali_month == null) {
      return { ok: false, error: "برای ماه مشخص، هم سال و هم ماه شمسی را بگویید." };
    }
    target = { jy: req.jalali_year, jm: req.jalali_month };
  } else if (req.period === "this_month") {
    target = today;
  } else if (req.period === "prev_month") {
    target = previousJalaliMonth(today.jy, today.jm);
  }

  if (!target) {
    const sorted = [...latestPerMonth].sort((a, b) => b.jalali_year - a.jalali_year || b.jalali_month - a.jalali_month);
    const item = sorted[0];
    return { ok: true, item, label: jalaliMonthLabel(item.jalali_year, item.jalali_month) };
  }

  const found = latestPerMonth.find((i) => i.jalali_year === target!.jy && i.jalali_month === target!.jm);
  if (!found) return { ok: false, error: `برای ${jalaliMonthLabel(target.jy, target.jm)} فیش حقوقی‌ای برای شما صادر نشده است.` };
  return { ok: true, item: found, label: jalaliMonthLabel(found.jalali_year, found.jalali_month) };
}

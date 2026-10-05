import { jalaliMonthLabel } from "@/lib/payroll/period";

/** Shape returned by payroll_payslip_data (0130). Every amount is an exact decimal STRING. */
export type PayslipState = "NOT_PAID" | "PARTIALLY_PAID" | "PAID";

export type PayslipData = {
  result_id: string;
  personnel_id: string;
  batch: { id: string; batch_number: string; currency: string };
  period: { jalali_year: number; jalali_month: number; period_start: string; period_end: string };
  personnel: { number: string; name: string; job_title: string | null; department: string | null; hire_date: string | null };
  lines: { code: string; name: string; type: "EARNING" | "DEDUCTION"; amount: string; quantity?: string; unit?: "HOURS" | "DAYS"; unit_rate?: string; proration?: { employed_days: number; period_days: number } }[];
  totals: { gross: string; deductions: string; net: string };
  payment: { state: PayslipState; paid: string; last_date: string | null; numbers: string[] };
  next_revision: number;
  latest_revision: number | null;
  can_issue: boolean;
  reason: string | null;
};

export const PAYSLIP_STATE_LABEL: Record<PayslipState, string> = {
  NOT_PAID: "در انتظار پرداخت",
  PARTIALLY_PAID: "پرداخت ناقص",
  PAID: "پرداخت‌شده",
};
export const PAYSLIP_STATE_TONE: Record<PayslipState, string> = {
  NOT_PAID: "status-draft",
  PARTIALLY_PAID: "status-waiting",
  PAID: "status-final",
};

/** Row of payroll_payslips_for_batch (no amounts). */
export type BatchPayslipRow = {
  result_id: string;
  personnel_number: string;
  personnel_name: string;
  current_state: PayslipState;
  can_issue: boolean;
  revisions: { id: string; revision: number; state: PayslipState; issued_at: string }[];
};

/** Row of my_payslips().items — the ONLY thing an employee ever receives. */
export type MyPayslip = {
  id: string;
  revision: number;
  payment_state: PayslipState;
  issued_at: string;
  jalali_year: number;
  jalali_month: number;
  currency: string;
  net: string;
  is_latest: boolean;
};

/** ASCII-safe archive file name (Content-Disposition also carries it percent-encoded). */
export function payslipFileName(personnelNumber: string, jalaliYear: number, jalaliMonth: number, revision: number): string {
  const safe = personnelNumber.replace(/[^A-Za-z0-9-]/g, "");
  return `payslip-${safe}-${jalaliYear}-${String(jalaliMonth).padStart(2, "0")}-r${revision}.pdf`;
}

export const payslipPeriodLabel = (d: Pick<PayslipData["period"], "jalali_year" | "jalali_month">) =>
  jalaliMonthLabel(d.jalali_year, d.jalali_month);

/** Shapes returned by payroll_dashboard / hr_payroll_gaps (0132). Amounts are exact decimal STRINGS, always per currency. */
export type CurrencyCard = {
  currency: string; personnel_count: number; incomplete: number;
  gross: string; deductions: string; net: string; employer_cost: string;
  approved_net: string; paid: string; outstanding: string;
};

export type PayrollDashboardData = {
  period: { id: string; jalali_year: number; jalali_month: number; period_start: string; period_end: string } | null;
  periods: { id: string; jalali_year: number; jalali_month: number }[];
  pipeline: { draft: number; calculated: number; pending_review: number; pending_approval: number; approved: number; pending_payment: number };
  currencies: CurrencyCard[];
  gaps: { missing_work_data: number; missing_compensation: number };
};

export type HrPayrollGaps = { missing_compensation: number; missing_work_data: number; period: { jalali_year: number; jalali_month: number } | null };

type PersonnelLite = { employment_status: string; hire_date: string | null; termination_date: string | null };

/** Headcount figures for the HR dashboard (pure, so it is unit-tested). `today` is an ISO date (yyyy-mm-dd). */
export function hrHeadcount(rows: PersonnelLite[], today: string, windowDays = 30) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - windowDays);
  const since = d.toISOString().slice(0, 10);
  const count = (s: string) => rows.filter((r) => r.employment_status === s).length;
  return {
    total: rows.length,
    active: count("ACTIVE"),
    on_leave: count("ON_LEAVE"),
    suspended: count("SUSPENDED"),
    terminated: count("TERMINATED"),
    archived: count("ARCHIVED"),
    new_hires: rows.filter((r) => r.hire_date && r.hire_date >= since && r.hire_date <= today).length,
    terminations: rows.filter((r) => r.termination_date && r.termination_date >= since && r.termination_date <= today).length,
    since,
  };
}

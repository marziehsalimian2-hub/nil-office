import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui";
import { toFaDigits } from "@/lib/jalali";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import { hrHeadcount, type HrPayrollGaps } from "@/lib/payroll/dashboard";

/**
 * HR dashboard (spec §55). Headcount comes from the HR tables via RLS; the two payroll-related items are COUNTS ONLY from
 * hr_payroll_gaps (no amounts). Payroll pipeline counts are shown only to users who also have payroll access.
 */
export async function HrDashboard({ showPayroll }: { showPayroll: boolean }) {
  const supabase = await createClient();
  const [{ data: rows }, { data: gaps }, pipe] = await Promise.all([
    supabase.from("personnel").select("employment_status, hire_date, termination_date").limit(10000),
    supabase.rpc("hr_payroll_gaps"),
    showPayroll ? supabase.rpc("payroll_dashboard") : Promise.resolve({ data: null }),
  ]);
  const h = hrHeadcount((rows ?? []) as { employment_status: string; hire_date: string | null; termination_date: string | null }[], new Date().toISOString().slice(0, 10));
  const g = (gaps ?? null) as HrPayrollGaps | null;
  const pipeline = (pipe.data as { pipeline?: { pending_review: number; pending_approval: number; pending_payment: number } } | null)?.pipeline ?? null;

  return (
    <section className="mb-6 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="پرسنل فعال" value={toFaDigits(h.active)} href="/personnel?status=ACTIVE" tone="seal" />
        <StatCard label="در مرخصی" value={toFaDigits(h.on_leave)} href="/personnel?status=ON_LEAVE" />
        <StatCard label="تعلیق" value={toFaDigits(h.suspended)} href="/personnel?status=SUSPENDED" />
        <StatCard label="پایان‌یافته" value={toFaDigits(h.terminated)} href="/personnel?status=TERMINATED" />
        <StatCard label="استخدام‌های ۳۰ روز اخیر" value={toFaDigits(h.new_hires)} href="/personnel/reports/hr_personnel_register" />
        <StatCard label="پایان همکاری ۳۰ روز اخیر" value={toFaDigits(h.terminations)} href="/personnel/reports/hr_personnel_register" />
        {g && (
          <>
            <StatCard label="فعال‌ها بدون پروفایل حقوق" value={toFaDigits(g.missing_compensation)} tone={g.missing_compensation ? "danger" : "ink"} />
            <StatCard
              label={`مشمولان بدون کارکرد${g.period ? ` (${jalaliMonthLabel(g.period.jalali_year, g.period.jalali_month)})` : ""}`}
              value={toFaDigits(g.missing_work_data)} tone={g.missing_work_data ? "warn" : "ink"}
            />
          </>
        )}
      </div>
      {pipeline && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="حقوق منتظر بررسی" value={toFaDigits(pipeline.pending_review)} href="/payroll/periods" tone={pipeline.pending_review ? "warn" : "ink"} />
          <StatCard label="حقوق منتظر تأیید نهایی" value={toFaDigits(pipeline.pending_approval)} href="/payroll/periods" tone={pipeline.pending_approval ? "warn" : "ink"} />
          <StatCard label="حقوق منتظر پرداخت" value={toFaDigits(pipeline.pending_payment)} href="/payroll/reports/payroll_outstanding" tone={pipeline.pending_payment ? "warn" : "ink"} />
        </div>
      )}
    </section>
  );
}

import Link from "next/link";
import { Card, StatCard } from "@/components/ui";
import { CURRENCY_LABEL, type Currency } from "@/lib/enums";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import { formatExactAmount } from "@/lib/payroll/format";
import { toFaDigits } from "@/lib/jalali";
import type { PayrollDashboardData } from "@/lib/payroll/dashboard";

/** Payroll dashboard (spec §56): pipeline counts + ONE card PER CURRENCY — currencies are never summed. Amounts are exact strings. */
export function PayrollDashboard({ data }: { data: PayrollDashboardData }) {
  const p = data.pipeline;
  return (
    <section className="mb-8 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">
          {data.period ? `وضعیت دورهٔ ${jalaliMonthLabel(data.period.jalali_year, data.period.jalali_month)}` : "هنوز دورهٔ حقوقی ثبت نشده است"}
        </h2>
        {data.periods.length > 0 && (
          <form method="get" className="flex items-center gap-2">
            <select name="period" defaultValue={data.period?.id ?? ""} className="input !py-1.5">
              {data.periods.map((x) => (<option key={x.id} value={x.id}>{jalaliMonthLabel(x.jalali_year, x.jalali_month)}</option>))}
            </select>
            <button type="submit" className="btn-ghost !py-1.5 text-xs">نمایش</button>
          </form>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="پیش‌نویس" value={toFaDigits(p.draft)} href="/payroll/periods" />
        <StatCard label="محاسبه‌شده" value={toFaDigits(p.calculated)} href="/payroll/periods" />
        <StatCard label="منتظر بررسی" value={toFaDigits(p.pending_review)} href="/payroll/periods" tone={p.pending_review ? "warn" : "ink"} />
        <StatCard label="منتظر تأیید نهایی" value={toFaDigits(p.pending_approval)} href="/payroll/periods" tone={p.pending_approval ? "warn" : "ink"} />
        <StatCard label="تأییدشده" value={toFaDigits(p.approved)} href="/payroll/periods" />
        <StatCard label="منتظر پرداخت" value={toFaDigits(p.pending_payment)} href="/payroll/reports/payroll_outstanding" tone={p.pending_payment ? "warn" : "ink"} />
      </div>

      {data.period && (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="افراد مشمول بدون کارکرد این ماه" value={toFaDigits(data.gaps.missing_work_data)} href={`/payroll/periods/${data.period.id}`} tone={data.gaps.missing_work_data ? "warn" : "ink"} />
          <StatCard label="افراد مشمول بدون پروفایل حقوق" value={toFaDigits(data.gaps.missing_compensation)} href="/personnel" tone={data.gaps.missing_compensation ? "danger" : "ink"} />
        </div>
      )}

      {data.currencies.length === 0 ? (
        data.period && <Card><p className="text-sm text-ink-muted">برای این دوره هنوز محاسبه‌ای انجام نشده است.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.currencies.map((c) => {
            const unit = CURRENCY_LABEL[c.currency as Currency] ?? c.currency;
            const rows: [string, string][] = [
              ["ناخالص", c.gross], ["کسورات", c.deductions], ["خالص", c.net], ["هزینهٔ کارفرما", c.employer_cost],
              ["خالص دسته‌های تأییدشده", c.approved_net], ["پرداخت‌شده", c.paid], ["مانده", c.outstanding],
            ];
            return (
              <Card key={c.currency}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">{unit}</h3>
                  <span className="text-xs text-ink-muted">
                    {toFaDigits(c.personnel_count)} نفر{c.incomplete > 0 ? ` — ${toFaDigits(c.incomplete)} ناقص` : ""}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {rows.map(([label, v]) => (
                    <div key={label} className="contents">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="tnum text-ink">{formatExactAmount(v)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-ink-muted">
        هر واحد پول جدا نمایش داده می‌شود و هرگز با واحد دیگر جمع نمی‌شود. «پرداخت‌شده» فقط پرداخت‌های قطعی است.{" "}
        <Link href="/payroll/reports" className="text-seal hover:underline">همهٔ گزارش‌ها</Link>
      </p>
    </section>
  );
}

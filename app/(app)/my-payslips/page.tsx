import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import { formatExactAmount } from "@/lib/payroll/format";
import { PAYSLIP_STATE_LABEL, PAYSLIP_STATE_TONE, type MyPayslip } from "@/lib/payroll/payslip";

export const dynamic = "force-dynamic";

/**
 * Self-service «فیش‌های حقوقی من». Lives OUTSIDE /payroll (that layout is payroll-role only). Everything comes from my_payslips() —
 * a SECURITY DEFINER read that resolves the caller's personnel record via personnel.profile_id and returns only their own payslips
 * (period, revision, status at issue, net) — never other staff, employer cost, warnings or bank data.
 */
export default async function MyPayslipsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_payslips");
  const res = (data ?? { linked: false, items: [] }) as { linked: boolean; items: MyPayslip[] };

  return (
    <div>
      <PageHeader title="فیش‌های حقوقی من" subtitle="فقط فیش‌های خودتان؛ فقط‌خواندنی و محرمانه" />
      {!res.linked ? (
        <Card>
          <p className="text-sm font-medium text-ink">حساب کاربری شما به پروندهٔ پرسنلی وصل نشده است.</p>
          <p className="mt-1 text-sm text-ink-muted">برای دیدن فیش‌ها، از مدیر منابع انسانی بخواهید حساب شما را به پروندهٔ پرسنلی‌تان وصل کند.</p>
        </Card>
      ) : res.items.length === 0 ? (
        <EmptyState title="هنوز فیشی برای شما صادر نشده است." hint="فیش‌ها پس از تأیید نهایی حقوق و صدور توسط واحد حقوق و دستمزد اینجا نمایش داده می‌شوند." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3 text-start">دوره</th>
                <th className="px-4 py-3 text-start">خالص</th>
                <th className="px-4 py-3 text-start">وضعیت پرداخت (در زمان صدور)</th>
                <th className="px-4 py-3 text-start">تاریخ صدور</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {res.items.map((s) => (
                <tr key={s.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-ink">
                    {jalaliMonthLabel(s.jalali_year, s.jalali_month)}
                    {!s.is_latest && <span className="ms-2 text-xs text-ink-muted">(نسخهٔ قدیمی‌تر)</span>}
                  </td>
                  <td className="tnum px-4 py-3">{formatExactAmount(s.net, s.currency)}</td>
                  <td className="px-4 py-3"><span className={`badge ${PAYSLIP_STATE_TONE[s.payment_state]}`}>{PAYSLIP_STATE_LABEL[s.payment_state]}</span></td>
                  <td className="tnum px-4 py-3 text-ink-muted">{formatJalali(s.issued_at)}</td>
                  <td className="px-4 py-3">
                    <a href={`/api/payslips/${s.id}/pdf`} target="_blank" rel="noreferrer" className="text-seal hover:underline">مشاهدهٔ PDF</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

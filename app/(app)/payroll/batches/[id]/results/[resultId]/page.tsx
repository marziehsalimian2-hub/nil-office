import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, StatCard } from "@/components/ui";
import {
  SALARY_COMPONENT_TYPE_LABEL, PAYROLL_LINE_METHOD_LABEL, PAYROLL_AMOUNT_SOURCE_LABEL, PAYROLL_PERCENTAGE_BASIS_LABEL,
  CURRENCY_LABEL, type Currency, type SalaryComponentType, type PayrollPercentageBasis,
} from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import { formatExactAmount } from "@/lib/payroll/format";
import type { ResultDetail } from "@/lib/payroll/review";
import { WarningsList } from "../../WarningsList";

export const dynamic = "force-dynamic";

const WD_LABELS: Record<string, string> = {
  work_days: "روز کارکرد", work_hours: "ساعت کارکرد", overtime_hours: "اضافه‌کاری (ساعت)", absence_days: "غیبت (روز)",
  absence_hours: "غیبت (ساعت)", paid_leave_days: "مرخصی با حقوق (روز)", unpaid_leave_days: "مرخصی بدون حقوق (روز)",
  mission_days: "ماموریت (روز)", mission_hours: "ماموریت (ساعت)",
};

export default async function PayrollResultPage({ params }: { params: Promise<{ id: string; resultId: string }> }) {
  const { id, resultId } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_result_detail", { p_result_id: resultId });
  if (error || !data) notFound();
  const d = data as ResultDetail;
  if (d.result.batch_id !== id) notFound();
  const cur = d.result.currency as Currency | null;
  const unit = cur ? (CURRENCY_LABEL[cur] ?? cur) : "";
  const wd = (d.result.inputs?.work_data ?? null) as Record<string, string | number | null> | null;

  return (
    <div>
      <PageHeader
        title={d.result.personnel_name}
        subtitle={`${d.result.personnel_number} — محاسبهٔ شمارهٔ ${toFaDigits(d.result.calculation_version)}${d.result.is_current ? " (فعلی)" : " (قدیمی؛ جایگزین شده)"}`}
        action={<Link href={`/payroll/batches/${id}`} className="btn-quiet">بازگشت به دسته</Link>}
      />
      {!d.result.is_current && (
        <div className="mb-4 rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-4 py-3 text-sm text-ink">این نتیجه مربوط به محاسبهٔ قدیمی‌تر است و فقط برای سابقه نگه‌داری می‌شود.</div>
      )}
      {!d.result.is_complete && (
        <div className="mb-4 rounded-lg border border-status-cancelled/40 bg-status-cancelled/5 px-4 py-3 text-sm text-status-cancelled">
          محاسبهٔ این فرد ناقص است؛ اقلام «محاسبه نشد» هیچ مبلغی ندارند و در جمع‌ها نیامده‌اند.
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`ناخالص (${unit})`} value={formatExactAmount(d.result.gross)} />
        <StatCard label={`کسورات (${unit})`} value={formatExactAmount(d.result.total_deductions)} />
        <StatCard label={`خالص (${unit})`} value={formatExactAmount(d.result.net)} tone="seal" />
        <StatCard label={`هزینهٔ کارفرما (${unit})`} value={formatExactAmount(d.result.employer_cost)} />
      </div>

      <div className="card mb-6 overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="table-head">
              <th className="px-3 py-2 text-start">جزء</th><th className="px-3 py-2 text-start">نوع</th><th className="px-3 py-2 text-start">روش</th>
              <th className="px-3 py-2 text-start">مبنا</th><th className="px-3 py-2 text-start">نرخ</th><th className="px-3 py-2 text-start">منبع نرخ / مبلغ</th>
              <th className="px-3 py-2 text-start">مبلغ</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.line_order} className={`table-row ${l.status === "NOT_COMPUTED" ? "bg-status-cancelled/5" : ""}`}>
                <td className="px-3 py-2"><div className="font-medium text-ink">{l.component_name_fa}</div><div className="text-xs text-ink-muted">{l.component_code}</div></td>
                <td className="px-3 py-2 text-ink-muted">{SALARY_COMPONENT_TYPE_LABEL[l.component_type as SalaryComponentType] ?? l.component_type}</td>
                <td className="px-3 py-2 text-ink-muted">{PAYROLL_LINE_METHOD_LABEL[l.method] ?? l.method}</td>
                <td className="tnum px-3 py-2 text-ink-muted">
                  {l.basis ? `${PAYROLL_PERCENTAGE_BASIS_LABEL[l.basis as PayrollPercentageBasis] ?? l.basis}${l.base_amount ? `: ${formatExactAmount(l.base_amount)}` : ""}` : "—"}
                </td>
                <td className="tnum px-3 py-2 text-ink-muted">{l.rate ? `${formatExactAmount(l.rate)}٪` : "—"}</td>
                <td className="px-3 py-2 text-xs text-ink-muted">
                  {l.rule_set_label ? <div>قاعده: {l.rule_set_label}{l.rule_key ? ` / ${l.rule_key}` : ""}</div> : null}
                  {l.amount_source ? PAYROLL_AMOUNT_SOURCE_LABEL[l.amount_source] ?? l.amount_source : "—"}
                </td>
                <td className={`tnum px-3 py-2 font-medium ${l.status === "NOT_COMPUTED" ? "text-status-cancelled" : "text-ink"}`}>
                  {l.status === "NOT_COMPUTED" ? "محاسبه نشد" : formatExactAmount(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">کارکرد ثبت‌شده در زمان محاسبه</h2>
          {wd ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {Object.entries(WD_LABELS).map(([k, label]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tnum text-ink">{wd[k] === null || wd[k] === undefined ? "—" : toFaDigits(String(wd[k]))}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">کارکردی ثبت نشده بود.</p>
          )}
          <p className="mt-3 text-xs text-ink-muted">نسخهٔ پروفایل حقوق: {d.result.compensation_version_number !== null ? toFaDigits(d.result.compensation_version_number) : "—"}</p>
        </Card>
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">هشدارهای این فرد</h2>
          <WarningsList warnings={d.warnings.map((w) => ({ ...w, personnel_id: resultId }))} names={{ [resultId]: d.result.personnel_name }} />
        </div>
      </div>
    </div>
  );
}

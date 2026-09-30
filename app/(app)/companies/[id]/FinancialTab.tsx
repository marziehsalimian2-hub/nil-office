import { Card } from "@/components/ui";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney, type DisplayUnit } from "@/lib/money";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import type { CompanyFinancialActivityRow, CompanyFinancialSummaryRow } from "@/lib/types/database";

const ACTIVITY_SOURCE_LABEL: Record<CompanyFinancialActivityRow["source"], string> = {
  RECEIPT: "دریافت",
  PAYMENT: "پرداخت",
  JOURNAL_LINE: "سند حسابداری",
};

export function FinancialTab({
  summary,
  activity,
  unit,
}: {
  summary: CompanyFinancialSummaryRow[];
  activity: CompanyFinancialActivityRow[];
  unit: DisplayUnit;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">خلاصهٔ مالی</p>
        {summary.length === 0 ? (
          <p className="text-sm text-ink-muted">فعالیت مالی ثبت‌شده‌ای برای این شرکت وجود ندارد.</p>
        ) : (
          <div className="space-y-3">
            {summary.map((r) => (
              <div key={r.currency_code} className="rounded-lg border border-paper-line bg-paper/40 p-3">
                <p className="mb-2 text-xs font-medium text-ink-muted" dir="ltr">
                  {r.currency_code}
                </p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-paper p-3">
                    <p className="text-xs text-ink-muted">دریافتی</p>
                    <p className="tnum mt-1 text-sm font-semibold text-status-received">{formatMoney(r.received_amount, unit)}</p>
                  </div>
                  <div className="rounded-lg bg-paper p-3">
                    <p className="text-xs text-ink-muted">پرداختی</p>
                    <p className="tnum mt-1 text-sm font-semibold text-ink">{formatMoney(r.paid_amount, unit)}</p>
                  </div>
                  <div className="rounded-lg bg-paper p-3">
                    <p className="text-xs text-ink-muted">مانده فاکتورهای صادرشده</p>
                    <p className="tnum mt-1 text-sm font-semibold text-seal">{formatMoney(r.outstanding_invoices_amount, unit)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">فعالیت مالی ثبت‌شده</p>
        {activity.length === 0 ? (
          <p className="text-sm text-ink-muted">هنوز فعالیت مالی ثبت‌شده‌ای برای این شرکت ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="table-head">
                  <th className="px-3 py-2">تاریخ</th>
                  <th className="px-3 py-2">نوع</th>
                  <th className="px-3 py-2">شرح</th>
                  <th className="px-3 py-2">شماره سند</th>
                  <th className="px-3 py-2 text-left">مبلغ</th>
                  <th className="px-3 py-2">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={`${row.source}-${row.id}`} className="table-row">
                    <td className="px-3 py-2 tnum text-ink-muted">{formatJalali(row.document_date)}</td>
                    <td className="px-3 py-2 text-ink">{ACTIVITY_SOURCE_LABEL[row.source]}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.description ?? "—"}</td>
                    <td className="px-3 py-2 tnum text-ink-muted" dir="ltr">
                      {row.document_number ? toFaDigits(row.document_number) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-left tnum ${row.direction === "IN" ? "text-status-received" : "text-ink"}`}>
                      {row.direction === "IN" ? "+" : "-"}
                      {formatMoney(row.amount, unit)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`badge ${POSTING_STATUS_TONE[row.status as PostingStatus]}`}>
                        {POSTING_STATUS_LABEL[row.status as PostingStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

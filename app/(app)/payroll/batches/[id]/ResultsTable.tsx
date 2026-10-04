"use client";

import { useState } from "react";
import Link from "next/link";
import { formatExactAmount } from "@/lib/payroll/format";
import { toFaDigits } from "@/lib/jalali";
import type { ReviewResult } from "@/lib/payroll/review";

export function ResultsTable({ batchId, results, currency, hasPrevious }: { batchId: string; results: ReviewResult[]; currency: string; hasPrevious: boolean }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const rows = onlyIssues ? results.filter((r) => r.critical_count > 0 || r.warning_count > 0 || !r.is_complete) : results;

  if (results.length === 0) return <p className="text-sm text-ink-muted">هنوز نتیجه‌ای وجود ندارد؛ دسته را محاسبه کنید.</p>;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
        فقط ردیف‌های دارای هشدار
      </label>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="table-head">
              <th className="px-3 py-2 text-start">فرد</th>
              <th className="px-3 py-2 text-start">ناخالص</th>
              <th className="px-3 py-2 text-start">کسورات</th>
              <th className="px-3 py-2 text-start">خالص</th>
              <th className="px-3 py-2 text-start">هزینهٔ کارفرما</th>
              {hasPrevious && <th className="px-3 py-2 text-start">خالص ماه قبل</th>}
              <th className="px-3 py-2 text-start">هشدار</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.result_id} className="table-row">
                <td className="px-3 py-2">
                  <Link href={`/payroll/batches/${batchId}/results/${r.result_id}`} className="font-medium text-seal hover:underline">{r.personnel_name}</Link>
                  <div className="tnum text-xs text-ink-muted">{r.personnel_number}</div>
                </td>
                <td className="tnum px-3 py-2">{formatExactAmount(r.gross)}</td>
                <td className="tnum px-3 py-2">{formatExactAmount(r.deductions)}</td>
                <td className={`tnum px-3 py-2 font-medium ${r.is_complete ? "text-ink" : "text-status-cancelled"}`}>
                  {r.is_complete ? formatExactAmount(r.net) : "ناقص"}
                  {r.is_complete && r.net.startsWith("-") && <span className="ms-1 text-xs text-status-cancelled">منفی</span>}
                </td>
                <td className="tnum px-3 py-2 text-ink-muted">{formatExactAmount(r.employer_cost)}</td>
                {hasPrevious && (
                  <td className="px-3 py-2 text-xs">
                    {r.is_new ? <span className="badge status-review">جدید</span> : (
                      <>
                        <span className="tnum text-ink-muted">{formatExactAmount(r.prev_net)}</span>
                        {r.net_change_pct !== null && (
                          <span className={`ms-1 tnum ${r.large_change ? "font-semibold text-status-waiting" : "text-ink-muted"}`} dir="ltr">
                            {toFaDigits(r.net_change_pct)}٪{r.large_change ? " — تغییر زیاد" : ""}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="flex gap-1 text-xs">
                    {r.critical_count > 0 && <span className="badge status-cancelled">{toFaDigits(r.critical_count)} بحرانی</span>}
                    {r.warning_count > 0 && <span className="badge status-waiting">{toFaDigits(r.warning_count)} هشدار</span>}
                    {r.critical_count === 0 && r.warning_count === 0 && <span className="text-ink-muted">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">همهٔ مبالغ به واحد {currency === "IRR" ? "ریال" : currency === "TOMAN" ? "تومان" : currency} دسته هستند. «ناقص» یعنی حداقل یک قلم محاسبه نشده است؛ جزئیات را در صفحهٔ فرد ببینید.</p>
    </div>
  );
}

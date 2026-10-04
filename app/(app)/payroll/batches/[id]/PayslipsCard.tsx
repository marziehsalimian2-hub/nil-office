"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issuePayslip } from "@/app/actions/payroll-payslips";
import { FormError } from "@/components/form";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { PAYSLIP_STATE_LABEL, PAYSLIP_STATE_TONE, type BatchPayslipRow } from "@/lib/payroll/payslip";

/**
 * Payslips of an APPROVED batch. Issuing is manual (payroll approve tier); an issued payslip is archived immutably and visible to the
 * linked employee at once. A new revision is possible only when the payment status changed since the latest revision.
 */
export function PayslipsCard({ batchId, rows, canIssue }: { batchId: string; rows: BatchPayslipRow[]; canIssue: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function issueOne(resultId: string): Promise<string | undefined> {
    const fd = new FormData();
    fd.set("result_id", resultId);
    fd.set("batch_id", batchId);
    const r = await issuePayslip(null, fd);
    return r?.error;
  }

  function one(resultId: string) {
    start(async () => {
      const err = await issueOne(resultId);
      if (err) setError(err);
      else { setError(undefined); router.refresh(); }
    });
  }

  function all() {
    const todo = rows.filter((r) => r.can_issue);
    if (todo.length === 0) return;
    start(async () => {
      let done = 0;
      const failures: string[] = [];
      setProgress({ done, total: todo.length });
      for (const r of todo) {           // sequential: one PDF render per request (no timeout on big batches)
        const err = await issueOne(r.result_id);
        if (err) failures.push(`${r.personnel_name}: ${err}`);
        done += 1;
        setProgress({ done, total: todo.length });
      }
      setProgress(null);
      setError(failures.length ? failures.join(" | ") : undefined);
      router.refresh();
    });
  }

  const pending = rows.filter((r) => r.can_issue).length;

  return (
    <div className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-ink">فیش‌های حقوقی</h2>
        <span className="text-xs text-ink-muted">{toFaDigits(rows.filter((r) => r.revisions.length > 0).length)} از {toFaDigits(rows.length)} نفر فیش دارند</span>
      </div>
      <FormError message={error} />
      {progress && <p className="text-xs text-ink-muted">در حال صدور… {toFaDigits(progress.done)} از {toFaDigits(progress.total)}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="table-head">
              <th className="px-2 py-2 text-start">فرد</th>
              <th className="px-2 py-2 text-start">وضعیت پرداخت فعلی</th>
              <th className="px-2 py-2 text-start">نسخه‌های صادرشده</th>
              {canIssue && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.result_id} className="table-row align-top">
                <td className="px-2 py-2"><div className="font-medium text-ink">{r.personnel_name}</div><div className="tnum text-xs text-ink-muted">{r.personnel_number}</div></td>
                <td className="px-2 py-2"><span className={`badge ${PAYSLIP_STATE_TONE[r.current_state]}`}>{PAYSLIP_STATE_LABEL[r.current_state]}</span></td>
                <td className="px-2 py-2">
                  {r.revisions.length === 0 ? <span className="text-xs text-ink-muted">صادر نشده</span> : (
                    <div className="flex flex-wrap gap-1 text-xs">
                      {r.revisions.map((v) => (
                        <a key={v.id} href={`/api/payslips/${v.id}/pdf`} target="_blank" rel="noreferrer" className={`badge ${PAYSLIP_STATE_TONE[v.state]}`}>
                          نسخهٔ {toFaDigits(v.revision)} · {PAYSLIP_STATE_LABEL[v.state]} · {formatJalali(v.issued_at)}
                        </a>
                      ))}
                    </div>
                  )}
                </td>
                {canIssue && (
                  <td className="px-2 py-2">
                    <button type="button" className="btn-quiet !py-1 text-xs" disabled={busy || !r.can_issue}
                      title={r.can_issue ? undefined : "وضعیت پرداخت از آخرین نسخه تغییر نکرده است"}
                      onClick={() => one(r.result_id)}>
                      {r.revisions.length === 0 ? "صدور فیش" : "صدور نسخهٔ جدید"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canIssue ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy || pending === 0} onClick={all}>
            صدور فیش‌ها{pending ? ` (${toFaDigits(pending)} نفر)` : ""}
          </button>
          <p className="text-xs text-ink-muted">
            فیش صادرشده تغییرناپذیر است و بلافاصله برای کارمند متصل‌به‌حساب قابل مشاهده می‌شود. وضعیت پرداخت روی فیش «در زمان صدور» است؛ پس از پرداخت، نسخهٔ جدید صادر کنید.
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">صدور فیش نیازمند دسترسی «تأیید» در حقوق و دستمزد است.</p>
      )}
    </div>
  );
}

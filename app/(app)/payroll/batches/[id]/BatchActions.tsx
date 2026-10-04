"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { calculateBatch, changeBatchStatus, markBatchReviewed } from "@/app/actions/payroll-runs";
import { FormError } from "@/components/form";

type Pending = "SEND_BACK" | "CANCEL" | null;

/**
 * Buttons shown by status and tier (UI gating only — every RPC re-checks the tier server-side).
 * CREATE: calculate / submit / cancel-in-DRAFT. APPROVE: mark reviewed / send back / cancel after DRAFT (reason required).
 */
export function BatchActions({
  batchId, status, stale, reviewed, canCreate, canApprove,
}: { batchId: string; status: string; stale: boolean; reviewed: boolean; canCreate: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState("");

  function done(r: { error?: string } | null) {
    if (r?.error) setError(r.error);
    else { setError(undefined); setPending(null); setNote(""); router.refresh(); }
  }
  const run = (fn: () => Promise<{ error?: string } | null>) => start(async () => done(await fn()));
  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set("batch_id", batchId);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  if (status === "CANCELLED") return <p className="text-sm text-ink-muted">این دسته لغو شده است.</p>;

  const canCancel = status === "DRAFT" ? canCreate : canApprove;

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {canCreate && (status === "DRAFT" || status === "CALCULATED") && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => run(() => calculateBatch(null, fd()))}>
            {status === "DRAFT" ? "محاسبه" : "محاسبهٔ مجدد"}
          </button>
        )}
        {canCreate && status === "CALCULATED" && (
          <button type="button" className="btn-seal" disabled={busy || stale} title={stale ? "ابتدا دوباره محاسبه کنید" : undefined}
            onClick={() => run(() => changeBatchStatus(null, fd({ new_status: "UNDER_REVIEW" })))}>
            ارسال برای بررسی
          </button>
        )}
        {canApprove && status === "UNDER_REVIEW" && !reviewed && (
          <button type="button" className="btn-seal" disabled={busy || stale} title={stale ? "ابتدا دوباره محاسبه کنید" : undefined}
            onClick={() => run(() => markBatchReviewed(null, fd()))}>
            ثبت «بررسی‌شد»
          </button>
        )}
        {canApprove && status === "UNDER_REVIEW" && (
          <button type="button" className="btn-quiet" disabled={busy} onClick={() => setPending("SEND_BACK")}>بازگشت برای اصلاح</button>
        )}
        {canCancel && (
          <button type="button" className="btn-quiet" disabled={busy}
            onClick={() => (status === "DRAFT" ? run(() => changeBatchStatus(null, fd({ new_status: "CANCELLED", note: "لغو پیش‌نویس" }))) : setPending("CANCEL"))}>
            لغو دسته
          </button>
        )}
      </div>
      {status === "UNDER_REVIEW" && reviewed && (
        <p className="text-xs text-status-final">این دسته «بررسی‌شده» ثبت شده است. تأیید نهایی و پرداخت در فاز بعد ارائه می‌شود.</p>
      )}
      {pending && (
        <div className="space-y-2 rounded-lg border border-paper-line bg-paper/40 p-3">
          <p className="text-xs text-ink-muted">{pending === "CANCEL" ? "لغو دسته قابل بازگشت نیست؛ دلیل را بنویسید." : "دلیل بازگشت برای اصلاح را بنویسید."}</p>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary !py-1.5 text-xs" disabled={busy || !note.trim()}
              onClick={() => run(() => changeBatchStatus(null, fd({ new_status: pending === "CANCEL" ? "CANCELLED" : "CALCULATED", note: note.trim() })))}>
              تأیید
            </button>
            <button type="button" className="btn-quiet !py-1.5 text-xs" onClick={() => { setPending(null); setNote(""); }}>انصراف</button>
          </div>
        </div>
      )}
    </div>
  );
}

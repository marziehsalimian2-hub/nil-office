"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markBillingBatchReady, reopenBillingBatch, cancelBillingBatch, convertBillingBatch } from "@/app/actions/billing-batches";
import { FormError } from "@/components/form";
import type { BillingBatchStatusT } from "@/lib/types/database";

export function BatchActions({ batchId, status }: { batchId: string; status: BillingBatchStatusT }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<"INVOICE" | "PROFORMA">("INVOICE");

  function run(action: (p: null, f: FormData) => Promise<{ error?: string } | null>, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.append("batch_id", batchId);
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        {status === "DRAFT" && (
          <button type="button" disabled={pending} className="btn-seal" onClick={() => run(markBillingBatchReady)}>
            آماده برای صدور
          </button>
        )}
        {status === "READY" && (
          <button type="button" disabled={pending} className="btn-quiet" onClick={() => run(reopenBillingBatch)}>
            بازگشت به پیش‌نویس
          </button>
        )}
        {(status === "DRAFT" || status === "READY") && (
          <button
            type="button"
            disabled={pending}
            className="btn-quiet text-status-cancelled"
            onClick={() => {
              if (confirm("این دسته لغو شود؟")) run(cancelBillingBatch);
            }}
          >
            لغو دسته
          </button>
        )}
      </div>
      {status === "READY" && (
        <div className="flex items-center gap-2 rounded-lg border border-paper-line bg-paper/40 p-3">
          <select value={type} onChange={(e) => setType(e.target.value as "INVOICE" | "PROFORMA")} className="input w-auto">
            <option value="INVOICE">فاکتور</option>
            <option value="PROFORMA">پیش‌فاکتور</option>
          </select>
          <button type="button" disabled={pending} className="btn-primary" onClick={() => run(convertBillingBatch, { type })}>
            {pending ? "در حال صدور…" : "تبدیل به سند فروش"}
          </button>
        </div>
      )}
    </div>
  );
}

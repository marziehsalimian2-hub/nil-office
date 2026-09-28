"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { removeBillingBatchItem, addManualAdjustmentItem } from "@/app/actions/billing-batches";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { BILLING_BATCH_SOURCE_TYPE_LABEL } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import type { BillingBatchItem, BillingBatchSourceTypeT } from "@/lib/types/database";

export function BatchItemsCard({ batchId, currency, items, editable }: { batchId: string; currency: string; items: BillingBatchItem[]; editable: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("حذف این ردیف؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("batch_id", batchId);
    startTransition(async () => {
      await removeBillingBatchItem(null, fd);
      router.refresh();
    });
  }

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addManualAdjustmentItem(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setAdding(false);
        router.refresh();
      }
    });
  }

  const total = items.reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">ردیف‌های دسته</p>
        {editable && !adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> ردیف دستی
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={handleAdd} className="mb-4 space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
          <input type="hidden" name="batch_id" value={batchId} />
          <FormError message={error} />
          <Field label="شرح" required>
            <input name="description" required className="input" />
          </Field>
          <Field label="مبلغ" required>
            <input type="number" name="amount" required min={0} step="any" className="input tnum" />
          </Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "در حال ذخیره…" : "افزودن"}
            </button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setAdding(false)}>
              انصراف
            </button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز ردیفی اضافه نشده است.</p>
      ) : (
        <>
          <ul className="divide-y divide-paper-line/60">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="text-sm text-ink">{it.description}</p>
                  <p className="text-xs text-ink-muted">{BILLING_BATCH_SOURCE_TYPE_LABEL[it.source_type as BillingBatchSourceTypeT]}</p>
                </div>
                <span className="tnum text-sm text-ink">{formatMoney(it.amount)}</span>
                {editable && (
                  <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(it.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-paper-line pt-3">
            <span className="text-sm font-medium text-ink">جمع کل</span>
            <span className="tnum text-sm font-medium text-seal">
              {formatMoney(total)} {currency}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

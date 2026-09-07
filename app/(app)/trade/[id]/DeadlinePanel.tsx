"use client";

import { useActionState } from "react";
import { extendTradeOfferDeadline, type ActionState } from "@/app/actions/trade";
import { Field, FormError, SubmitButton } from "@/components/form";
import { formatJalali } from "@/lib/jalali";
import { TRADE_DEADLINE_TYPE, TRADE_DEADLINE_TYPE_LABEL } from "@/lib/enums";

type HistoryRow = {
  id: string;
  deadline_type: "INTEREST" | "DOCUMENT";
  old_value: string;
  new_value: string;
  changed_at: string;
  reason: string | null;
};

export function DeadlinePanel({
  offerId,
  canApprove,
  currentInterestDeadline,
  currentDocumentDeadline,
  history,
}: {
  offerId: string;
  canApprove: boolean;
  currentInterestDeadline: string;
  currentDocumentDeadline: string;
  history: HistoryRow[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(extendTradeOfferDeadline, null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs text-ink-muted">مهلت اعلام تمایل فعلی</p>
          <p className="mt-1 text-sm font-medium text-ink">{formatJalali(currentInterestDeadline)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-muted">مهلت ارسال LOI/ICPO فعلی</p>
          <p className="mt-1 text-sm font-medium text-ink">{formatJalali(currentDocumentDeadline)}</p>
        </div>
      </div>

      {canApprove && (
        <form action={formAction} className="card space-y-3 p-4">
          <input type="hidden" name="offer_id" value={offerId} />
          <p className="text-sm font-medium text-ink">تمدید مهلت</p>
          <FormError message={state?.error} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="نوع مهلت" required>
              <select name="deadline_type" required className="input">
                {TRADE_DEADLINE_TYPE.map((t) => (<option key={t} value={t}>{TRADE_DEADLINE_TYPE_LABEL[t]}</option>))}
              </select>
            </Field>
            <Field label="مهلت جدید" required>
              <input name="new_value" type="datetime-local" required className="input" dir="ltr" />
            </Field>
            <Field label="دلیل (اختیاری)">
              <input name="reason" className="input" />
            </Field>
          </div>
          <SubmitButton variant="seal">ثبت تمدید</SubmitButton>
        </form>
      )}

      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">تاریخچهٔ تمدید مهلت‌ها</p>
        {history.length === 0 ? (
          <p className="text-sm text-ink-muted">هنوز مهلتی تمدید نشده است.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="border-b border-paper-line pb-2 text-sm last:border-0">
                <p className="text-ink">
                  {TRADE_DEADLINE_TYPE_LABEL[h.deadline_type]}: {formatJalali(h.old_value)} ← {formatJalali(h.new_value)}
                </p>
                <p className="text-xs text-ink-muted">{formatJalali(h.changed_at)}{h.reason ? ` — ${h.reason}` : ""}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { submitTradeResponse, type ActionState } from "./actions";
import { FormError, SubmitButton } from "@/components/form";
import { TRADE_RESPONSE_TYPE, TRADE_RESPONSE_TYPE_LABEL, type TradeResponseType } from "@/lib/enums";

export function ResponseForm({ token, latest }: { token: string; latest: TradeResponseType | null }) {
  const boundAction = submitTradeResponse.bind(null, token);
  const [state, formAction] = useActionState<ActionState, FormData>(boundAction, null);

  if (state?.ok) {
    return (
      <div className="card border-status-received/40 bg-status-received/5 p-4">
        <p className="text-sm font-medium text-ink">پاسخ شما با موفقیت دریافت شد.</p>
        <p className="mt-1 text-xs text-ink-muted">
          این پاسخ به‌منزلهٔ رزرو کالا، قفل قیمت یا تعهد قطعی نیست؛ شرایط نهایی توسط فروشنده در زمان دریافت درخواست رسمی تأیید می‌شود.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-3 p-4">
      <p className="text-sm font-medium text-ink">پاسخ شما به این آفر{latest ? " (پاسخ قبلی: " + TRADE_RESPONSE_TYPE_LABEL[latest] + ")" : ""}</p>
      <FormError message={state?.error} />
      <div className="flex flex-wrap gap-3">
        {TRADE_RESPONSE_TYPE.map((t) => (
          <label key={t} className="flex items-center gap-2 rounded-lg border border-paper-line px-3 py-2 text-sm has-[:checked]:border-seal has-[:checked]:bg-seal/5">
            <input type="radio" name="response_type" value={t} required defaultChecked={latest === t} />
            {TRADE_RESPONSE_TYPE_LABEL[t]}
          </label>
        ))}
      </div>
      <textarea name="explanation" rows={3} placeholder="توضیح (اختیاری)" className="input" />
      <p className="text-xs text-ink-muted">
        اعلام «علاقه‌مندم» به‌معنای رزرو کالا، قفل قیمت یا تعهد قطعی نیست.
      </p>
      <SubmitButton variant="seal">ثبت پاسخ</SubmitButton>
    </form>
  );
}

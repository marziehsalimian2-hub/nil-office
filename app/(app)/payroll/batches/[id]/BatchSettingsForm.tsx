"use client";

import { useActionState } from "react";
import { updateBatchSettings, type ActionState } from "@/app/actions/payroll-runs";
import { Field, FormError, SubmitButton } from "@/components/form";
import { PAYROLL_ROUNDING_MODE, PAYROLL_ROUNDING_MODE_LABEL } from "@/lib/enums";

export function BatchSettingsForm({
  batchId, jurisdiction, roundingScale, roundingMode, jurisdictions,
}: { batchId: string; jurisdiction: string | null; roundingScale: number; roundingMode: string; jurisdictions: string[] }) {
  const [state, run] = useActionState<ActionState, FormData>(updateBatchSettings, null);
  const opts = jurisdiction && !jurisdictions.includes(jurisdiction) ? [...jurisdictions, jurisdiction] : jurisdictions;
  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="batch_id" value={batchId} />
      <FormError message={state?.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="حوزهٔ قانونی">
          <select name="jurisdiction" className="input" defaultValue={jurisdiction ?? ""}>
            <option value="">بدون قاعدهٔ قانونی</option>
            {opts.map((j) => (<option key={j} value={j}>{j}</option>))}
          </select>
        </Field>
        <Field label="تعداد رقم اعشار">
          <input name="rounding_scale" type="number" min={0} max={4} required className="input tnum" defaultValue={roundingScale} />
        </Field>
        <Field label="روش گرد کردن">
          <select name="rounding_mode" className="input" defaultValue={roundingMode}>
            {PAYROLL_ROUNDING_MODE.map((m) => (<option key={m} value={m}>{PAYROLL_ROUNDING_MODE_LABEL[m]}</option>))}
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="primary">ذخیرهٔ تنظیمات</SubmitButton>
        {state?.ok && <span className="text-xs text-status-final">ذخیره شد؛ برای اعمال، دسته را دوباره محاسبه کنید.</span>}
      </div>
    </form>
  );
}

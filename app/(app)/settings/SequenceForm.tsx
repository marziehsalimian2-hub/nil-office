"use client";
import { useActionState } from "react";
import { initSequence, type ActionState } from "@/app/actions/entities";
import { Field, FormError, SubmitButton } from "@/components/form";

export function SequenceForm({ currentYear }: { currentYear: number }) {
  const [state, action] = useActionState<ActionState, FormData>(initSequence, null);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      {state === null && <p className="hidden" />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="دامنه">
          <select name="scope" className="input" defaultValue="OUTGOING">
            <option value="OUTGOING">صادره</option>
            <option value="INCOMING">وارده</option>
            <option value="CASE">پرونده</option>
          </select>
        </Field>
        <Field label="سال (شمسی)">
          <input name="year" type="number" defaultValue={currentYear} className="input tnum" dir="ltr" />
        </Field>
        <Field label="آخرین شمارهٔ استفاده‌شده">
          <input name="last_value" type="number" defaultValue={0} className="input tnum" dir="ltr" />
        </Field>
      </div>
      <p className="text-xs text-ink-muted">
        شمارهٔ بعدی برابر «آخرین شماره + ۱» خواهد بود. مثال: برای ادامهٔ بایگانی صادرهٔ نیل، مقدار ۶۹ را ثبت کنید تا نامهٔ بعدی ۷۰ شود.
      </p>
      <SubmitButton variant="primary">ذخیرهٔ مقدار اولیه</SubmitButton>
    </form>
  );
}

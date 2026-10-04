"use client";

import { useActionState, useState } from "react";
import { createPayrollBatch, type ActionState } from "@/app/actions/payroll-runs";
import { Field, FormError, SubmitButton } from "@/components/form";
import { CURRENCY, CURRENCY_LABEL, PAYROLL_ROUNDING_MODE, PAYROLL_ROUNDING_MODE_LABEL } from "@/lib/enums";
import { defaultRounding } from "@/lib/payroll/review";

export function NewBatchForm({ periodId, jurisdictions, usedCurrencies }: { periodId: string; jurisdictions: string[]; usedCurrencies: string[] }) {
  const [state, run] = useActionState<ActionState, FormData>(createPayrollBatch, null);
  const [currency, setCurrency] = useState("");
  const [scale, setScale] = useState("0");
  const [mode, setMode] = useState("HALF_UP");

  function pickCurrency(c: string) {
    setCurrency(c);
    const d = defaultRounding(c);
    setScale(String(d.scale));
    setMode(d.mode);
  }

  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="period_id" value={periodId} />
      <FormError message={state?.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="واحد پول دسته" required hint="هر دسته فقط یک واحد پول دارد و مبالغ ارزهای مختلف هرگز جمع نمی‌شوند">
          <select name="currency" required className="input" value={currency} onChange={(e) => pickCurrency(e.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {CURRENCY.filter((c) => !usedCurrencies.includes(c)).map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}
          </select>
        </Field>
        <Field label="تعداد رقم اعشار" required hint="هر قلم یک‌بار گرد می‌شود؛ جمع‌ها گرد نمی‌شوند">
          <input name="rounding_scale" type="number" min={0} max={4} required className="input tnum" value={scale} onChange={(e) => setScale(e.target.value)} />
        </Field>
        <Field label="روش گرد کردن" required>
          <select name="rounding_mode" className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            {PAYROLL_ROUNDING_MODE.map((m) => (<option key={m} value={m}>{PAYROLL_ROUNDING_MODE_LABEL[m]}</option>))}
          </select>
        </Field>
      </div>
      <Field label="حوزهٔ قانونی" hint="فقط مجموعه‌های «تأییدشده» همین حوزه برای قواعد (مثل نرخ بیمه) استفاده می‌شوند. اگر هیچ قاعده‌ای لازم نیست، خالی بگذارید.">
        <select name="jurisdiction" className="input" defaultValue="">
          <option value="">بدون قاعدهٔ قانونی</option>
          {jurisdictions.map((j) => (<option key={j} value={j}>{j}</option>))}
        </select>
      </Field>
      <Field label="یادداشت (اختیاری)"><input name="notes" className="input" /></Field>
      <SubmitButton variant="primary">ایجاد دسته</SubmitButton>
    </form>
  );
}

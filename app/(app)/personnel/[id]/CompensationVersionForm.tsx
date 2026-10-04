"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompensationVersion } from "@/app/actions/payroll-compensation";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { CURRENCY, CURRENCY_LABEL, PAYMENT_FREQUENCY, PAYMENT_FREQUENCY_LABEL } from "@/lib/enums";
import { CompensationLinesEditor, type ComponentOption, type LineRow } from "./CompensationLinesEditor";

export function CompensationVersionForm({
  personnelId, options, initialLines, hasCurrent,
}: { personnelId: string; options: ComponentOption[]; initialLines: LineRow[]; hasCurrent: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!hasCurrent);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [base, setBase] = useState("");
  const [hourly, setHourly] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("personnel_id", personnelId);
    start(async () => {
      const r = await createCompensationVersion(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(undefined);
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return <button type="button" className="btn-quiet" onClick={() => setOpen(true)}>ثبت نسخهٔ جدید حقوق و مزایا</button>;
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-paper-line bg-paper/40 p-4">
      <p className="text-sm font-medium text-ink">{hasCurrent ? "نسخهٔ جدید حقوق و مزایا" : "ثبت اولین نسخهٔ حقوق و مزایا"}</p>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="معتبر از" required><JalaliDateInput name="effective_from" required /></Field>
        <Field label="حقوق پایه" required><MoneyInput name="base_salary" required value={base} onChange={setBase} /></Field>
        <Field label="واحد پول" required hint="ریال یا تومان را صریح انتخاب کنید">
          <select name="currency" required className="input" defaultValue="">
            <option value="" disabled>— انتخاب —</option>
            {CURRENCY.map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="دورهٔ پرداخت" required>
          <select name="payment_frequency" required className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {PAYMENT_FREQUENCY.map((f) => (<option key={f} value={f}>{PAYMENT_FREQUENCY_LABEL[f]}</option>))}
          </select>
        </Field>
        <Field label={frequency === "HOURLY" ? "نرخ ساعتی (الزامی)" : "نرخ ساعتی (اختیاری)"}>
          <MoneyInput name="hourly_rate" required={frequency === "HOURLY"} value={hourly} onChange={setHourly} />
        </Field>
        <Field label="یادداشت"><input name="notes" className="input" /></Field>
      </div>
      <CompensationLinesEditor options={options} initial={initialLines} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-sm">{pending ? "در حال ذخیره…" : "ثبت نسخه"}</button>
        {hasCurrent && <button type="button" disabled={pending} className="btn-quiet !py-1.5 text-sm" onClick={() => setOpen(false)}>انصراف</button>}
      </div>
      {hasCurrent && <p className="text-xs text-ink-muted">نسخهٔ فعلی از «تاریخ شروع» نسخهٔ جدید بسته و قفل می‌شود؛ حقوق‌های دورهٔ قبل تغییر نمی‌کنند.</p>}
    </form>
  );
}

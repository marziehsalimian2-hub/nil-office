"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createPayrollPeriod, type ActionState } from "@/app/actions/payroll-runs";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JALALI_MONTH_NAMES, jalaliMonthRange } from "@/lib/payroll/period";
import { formatJalali, toFaDigits } from "@/lib/jalali";

export function NewPeriodForm({ defaultYear, defaultMonth }: { defaultYear: number; defaultMonth: number }) {
  const [state, run] = useActionState<ActionState, FormData>(createPayrollPeriod, null);
  const [jy, setJy] = useState(defaultYear);
  const [jm, setJm] = useState(defaultMonth);
  const range = jy >= 1300 && jy <= 1500 ? jalaliMonthRange(jy, jm) : null;

  return (
    <form action={run} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="سال شمسی" required>
            <input name="jalali_year" type="number" min={1300} max={1500} required className="input tnum" value={jy}
              onChange={(e) => setJy(Number(e.target.value) || defaultYear)} />
          </Field>
          <Field label="ماه" required>
            <select name="jalali_month" className="input" value={jm} onChange={(e) => setJm(Number(e.target.value))}>
              {JALALI_MONTH_NAMES.map((n, i) => (<option key={n} value={i + 1}>{n}</option>))}
            </select>
          </Field>
        </div>
        {range && (
          <p className="text-sm text-ink-muted">
            بازهٔ دوره: <span className="tnum text-ink">{formatJalali(range.start)}</span> تا <span className="tnum text-ink">{formatJalali(range.end)}</span>
            {" "}({toFaDigits(range.days)} روز)
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ایجاد دوره</SubmitButton>
        <Link href="/payroll/periods" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

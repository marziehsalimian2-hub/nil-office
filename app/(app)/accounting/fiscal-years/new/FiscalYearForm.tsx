"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createFiscalYear, type ActionState } from "@/app/actions/accounting";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
export function FiscalYearForm() {
  const [state, action] = useActionState<ActionState, FormData>(createFiscalYear, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="عنوان سال مالی" required><input name="title" required className="input" placeholder="سال مالی ۱۴۰۵" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ شروع" required><JalaliDateInput name="start_date" required /></Field>
          <Field label="تاریخ پایان" required><JalaliDateInput name="end_date" required /></Field>
        </div>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت سال مالی</SubmitButton>
        <Link href="/accounting/fiscal-years" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

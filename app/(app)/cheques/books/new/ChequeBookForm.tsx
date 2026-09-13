"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createChequeBook, type ActionState } from "@/app/actions/cheques";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";

type Opt = { id: string; label: string };

export function ChequeBookForm({ bankAccounts }: { bankAccounts: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createChequeBook, null);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="حساب بانکی" required>
          <select name="bank_account_id" required className="input" defaultValue="">
            <option value="" disabled>
              — انتخاب —
            </option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شناسهٔ دسته‌چک" required>
          <input name="book_identifier" required className="input" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اولین شمارهٔ برگه" required>
            <input name="first_cheque_number" required dir="ltr" className="input text-center tnum" />
          </Field>
          <Field label="آخرین شمارهٔ برگه" required>
            <input name="last_cheque_number" required dir="ltr" className="input text-center tnum" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تعداد برگه" required>
            <input name="leaves_count" type="number" min={1} required dir="ltr" className="input text-center tnum" />
          </Field>
          <Field label="تاریخ صدور" required>
            <JalaliDateInput name="issue_date" required />
          </Field>
        </div>
        <Field label="توضیحات">
          <textarea name="description" rows={2} className="input" />
        </Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت دسته‌چک</SubmitButton>
        <Link href="/cheques/books" className="btn-quiet">
          انصراف
        </Link>
      </div>
    </form>
  );
}

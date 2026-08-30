"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createBankAccount, type ActionState } from "@/app/actions/accounting";
import { Field, FormError, SubmitButton } from "@/components/form";
type Opt = { id: string; label: string };
export function BankForm({ accounts }: { accounts: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createBankAccount, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع" required>
            <select name="kind" className="input" defaultValue="BANK"><option value="BANK">بانک</option><option value="CASH">صندوق</option></select>
          </Field>
          <Field label="عنوان حساب" required><input name="account_title" required className="input" placeholder="حساب جاری بانک ملت" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام بانک"><input name="bank_name" className="input" /></Field>
          <Field label="شعبه"><input name="branch" className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شماره حساب"><input name="account_number" dir="ltr" className="input tnum" /></Field>
          <Field label="شبا (IBAN)"><input name="iban" dir="ltr" className="input tnum" placeholder="IR..." /></Field>
        </div>
        <Field label="حساب حسابداری متصل (معین صندوق/بانک)" required>
          <select name="account_id" required className="input" defaultValue="">
            <option value="" disabled>— انتخاب حساب —</option>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink-muted">هیچ رمز، PIN یا اطلاعات ورود بانکی ذخیره نمی‌شود.</p>
      <div className="flex gap-3"><SubmitButton variant="primary">ثبت حساب</SubmitButton><Link href="/accounting/banks" className="btn-quiet">انصراف</Link></div>
    </form>
  );
}

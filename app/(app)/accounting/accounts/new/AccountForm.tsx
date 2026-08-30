"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createAccount, type ActionState } from "@/app/actions/accounting";
import { Field, FormError, SubmitButton } from "@/components/form";
import { ACCOUNT_TYPE, ACCOUNT_TYPE_LABEL, ACCOUNT_NATURE, ACCOUNT_NATURE_LABEL, ACCOUNT_LEVEL_LABEL } from "@/lib/enums";
type Opt = { id: string; label: string };
export function AccountForm({ parents }: { parents: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createAccount, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="کد حساب" required><input name="code" required dir="ltr" className="input text-center tnum" /></Field>
          <Field label="نام حساب" required><input name="name" required className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="سطح" required>
            <select name="level" className="input" defaultValue="3">
              {[1,2,3,4].map((l) => (<option key={l} value={l}>{ACCOUNT_LEVEL_LABEL[l]}</option>))}
            </select>
          </Field>
          <Field label="ماهیت" required>
            <select name="nature" className="input" defaultValue="DEBIT">
              {ACCOUNT_NATURE.map((n) => (<option key={n} value={n}>{ACCOUNT_NATURE_LABEL[n]}</option>))}
            </select>
          </Field>
          <Field label="نوع حساب" required>
            <select name="account_type" className="input" defaultValue="ASSET">
              {ACCOUNT_TYPE.map((t) => (<option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>))}
            </select>
          </Field>
        </div>
        <Field label="حساب والد">
          <select name="parent_id" className="input" defaultValue="">
            <option value="">— بدون والد —</option>
            {parents.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="allows_posting" value="true" className="h-4 w-4 accent-[#9a6a2e]" defaultChecked />
          <span className="text-sm text-ink">اجازهٔ ثبت سند روی این حساب (حساب قابل‌ثبت)</span>
        </label>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت حساب</SubmitButton>
        <Link href="/accounting/accounts" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

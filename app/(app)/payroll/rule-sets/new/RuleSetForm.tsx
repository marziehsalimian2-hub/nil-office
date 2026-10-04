"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createLegalRuleSet, type ActionState } from "@/app/actions/payroll-rules";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";

type Opt = { id: string; label: string };

export function RuleSetForm({ existing }: { existing: Opt[] }) {
  const [state, run] = useActionState<ActionState, FormData>(createLegalRuleSet, null);
  return (
    <form action={run} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام مجموعه" required><input name="name" required className="input" placeholder="مثلاً: قواعد بیمه" /></Field>
          <Field label="حوزهٔ قانونی" required><input name="jurisdiction" required className="input" placeholder="مثلاً: ایران" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="معتبر از" required><JalaliDateInput name="effective_from" required /></Field>
          <Field label="معتبر تا پیش از (اختیاری)"><JalaliDateInput name="effective_to" /></Field>
        </div>
        <Field label="منبع / مرجع قانونی" hint="مرجع رسمی (مصوبه، بخشنامه، ...) که مقادیر از آن گرفته شده است">
          <input name="source_reference" className="input" />
        </Field>
        <Field label="کپی قواعد از مجموعهٔ موجود (اختیاری)" hint="قواعد به‌صورت پیش‌نویس کپی می‌شوند و باید دوباره بررسی و تأیید شوند">
          <select name="copy_from_id" className="input" defaultValue=""><option value="">— بدون کپی —</option>
            {existing.map((e) => (<option key={e.id} value={e.id}>{e.label}</option>))}
          </select>
        </Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ایجاد مجموعه (پیش‌نویس)</SubmitButton>
        <Link href="/payroll/rule-sets" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

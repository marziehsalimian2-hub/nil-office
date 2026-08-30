"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createCompany, type ActionState } from "@/app/actions/entities";
import { Field, FormError, SubmitButton } from "@/components/form";

export function CompanyForm() {
  const [state, action] = useActionState<ActionState, FormData>(createCompany, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام شرکت (حقوقی)" required>
            <input name="legal_name" required className="input" />
          </Field>
          <Field label="نام انگلیسی">
            <input name="english_name" dir="ltr" className="input text-left" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="کشور"><input name="country" className="input" /></Field>
          <Field label="شخص رابط"><input name="contact_person" className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ایمیل"><input name="email" dir="ltr" className="input text-left" /></Field>
          <Field label="تلفن"><input name="phone" dir="ltr" className="input text-left" /></Field>
        </div>
        <Field label="نشانی"><textarea name="address" rows={2} className="input" /></Field>
        <Field label="یادداشت"><textarea name="notes" rows={2} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت شرکت</SubmitButton>
        <Link href="/companies" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

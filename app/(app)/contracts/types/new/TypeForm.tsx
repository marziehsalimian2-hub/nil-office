"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createContractType, type ActionState } from "@/app/actions/contracts";
import { Field, FormError, SubmitButton } from "@/components/form";

export function TypeForm() {
  const [state, action] = useActionState<ActionState, FormData>(createContractType, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="کد" required hint="یک شناسهٔ انگلیسی کوتاه، مثلاً SERVICE">
          <input name="code" required dir="ltr" className="input text-center tnum" />
        </Field>
        <Field label="نام فارسی" required>
          <input name="name" required className="input" />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_active" value="true" className="h-4 w-4 accent-[#9a6a2e]" defaultChecked />
          <span className="text-sm text-ink">فعال</span>
        </label>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت نوع قرارداد</SubmitButton>
        <Link href="/contracts/types" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

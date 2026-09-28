"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createServiceCategory, type ActionState } from "@/app/actions/service-categories";
import { Field, FormError, SubmitButton } from "@/components/form";

export function CategoryForm() {
  const [state, action] = useActionState<ActionState, FormData>(createServiceCategory, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="کد" required hint="یک شناسهٔ انگلیسی کوتاه، مثلاً CONSULTING">
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
        <SubmitButton variant="primary">ثبت دستهٔ خدمت</SubmitButton>
        <Link href="/service-ledger/categories" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

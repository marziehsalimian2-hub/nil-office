"use client";
import { useActionState } from "react";
import { createContractType, type ActionState } from "@/app/actions/contracts";
import { Field, FormError, SubmitButton } from "@/components/form";

export function ContractTypeForm() {
  const [state, action] = useActionState<ActionState, FormData>(createContractType, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormError message={state?.error} />
      <Field label="کد">
        <input name="code" required dir="ltr" className="input w-32" placeholder="LICENSING" />
      </Field>
      <Field label="عنوان فارسی">
        <input name="label_fa" required className="input" placeholder="مجوز و لایسنس" />
      </Field>
      <SubmitButton variant="ghost">افزودن نوع</SubmitButton>
    </form>
  );
}

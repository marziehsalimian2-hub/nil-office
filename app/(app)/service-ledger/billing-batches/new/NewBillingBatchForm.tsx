"use client";
import { useActionState, useState } from "react";
import { createBillingBatch, type ActionState } from "@/app/actions/billing-batches";
import { Field, FormError, SubmitButton } from "@/components/form";

export function NewBillingBatchForm({
  options,
  defaultId,
}: {
  options: { id: string; label: string; currency: string }[];
  defaultId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createBillingBatch, null);
  const [selected, setSelected] = useState(defaultId ?? options[0]?.id ?? "");
  const currency = options.find((o) => o.id === selected)?.currency ?? "IRR";

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="مشتری (پروندهٔ خدمات)" required>
          <select name="client_service_file_id" required className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <input type="hidden" name="currency" value={currency} />
      </div>
      <SubmitButton variant="primary">ایجاد دسته</SubmitButton>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { updateChequeGlobalOffset, type ActionState } from "@/app/actions/cheques";
import { Field, FormError, SubmitButton } from "@/components/form";

export function GlobalOffsetForm({ templateId, offsetX, offsetY }: { templateId: string; offsetX: number; offsetY: number }) {
  const [state, action] = useActionState<ActionState, FormData>(updateChequeGlobalOffset, null);
  return (
    <form action={action} className="space-y-3">
      <FormError message={state?.error} />
      <input type="hidden" name="id" value={templateId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="افست افقی (mm)">
          <input name="offset_x_mm" type="number" step="0.1" defaultValue={offsetX} dir="ltr" className="input text-center tnum" />
        </Field>
        <Field label="افست عمودی (mm)">
          <input name="offset_y_mm" type="number" step="0.1" defaultValue={offsetY} dir="ltr" className="input text-center tnum" />
        </Field>
      </div>
      <SubmitButton variant="ghost">ذخیرهٔ افست کلی</SubmitButton>
    </form>
  );
}

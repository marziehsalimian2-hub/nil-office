"use client";

import { useActionState } from "react";
import { updateChequePrintTemplateField, createChequePrintTemplateField, type ActionState } from "@/app/actions/cheques";
import { Field, FormError, SubmitButton } from "@/components/form";
import type { ChequePrintTemplateField } from "@/lib/types/database";

const FIELD_LABEL: Record<string, string> = {
  DATE: "تاریخ",
  PAYEE: "ذی‌نفع",
  AMOUNT_NUMERIC: "مبلغ (عددی)",
  AMOUNT_WORDS: "مبلغ (به حروف)",
  PURPOSE: "بابت",
  SAYAD_ID: "شناسهٔ صیاد",
  ACCOUNT_INFO: "اطلاعات حساب",
  CUSTOM_TEXT: "متن دلخواه",
};

/** One numeric X/Y calibration row per field (confirmed approach for v1 — see CHEQUE_PRINTING.md). */
export function FieldForm({ field }: { field: ChequePrintTemplateField }) {
  const [state, action] = useActionState<ActionState, FormData>(updateChequePrintTemplateField, null);
  return (
    <form action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-paper-line p-3 sm:grid-cols-4 lg:grid-cols-8">
      <input type="hidden" name="id" value={field.id} />
      <input type="hidden" name="template_id" value={field.template_id} />
      <div className="col-span-2 flex items-center text-sm font-medium text-ink sm:col-span-4 lg:col-span-1">
        {FIELD_LABEL[field.field_key] ?? field.field_key}
      </div>
      <Field label="X (mm)">
        <input name="x_mm" type="number" step="0.1" defaultValue={field.x_mm} dir="ltr" className="input text-center tnum" />
      </Field>
      <Field label="Y (mm)">
        <input name="y_mm" type="number" step="0.1" defaultValue={field.y_mm} dir="ltr" className="input text-center tnum" />
      </Field>
      <Field label="عرض (mm)">
        <input name="width_mm" type="number" step="0.1" defaultValue={field.width_mm} dir="ltr" className="input text-center tnum" />
      </Field>
      <Field label="ارتفاع (mm)">
        <input name="height_mm" type="number" step="0.1" defaultValue={field.height_mm} dir="ltr" className="input text-center tnum" />
      </Field>
      <Field label="اندازهٔ فونت (pt)">
        <input name="font_size_pt" type="number" step="0.5" defaultValue={field.font_size_pt} dir="ltr" className="input text-center tnum" />
      </Field>
      <Field label="چینش">
        <select name="alignment" defaultValue={field.alignment} className="input">
          <option value="RIGHT">راست</option>
          <option value="LEFT">چپ</option>
          <option value="CENTER">وسط</option>
        </select>
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="ghost">ذخیره</SubmitButton>
      </div>
      {state?.error && (
        <div className="col-span-full">
          <FormError message={state.error} />
        </div>
      )}
    </form>
  );
}

const ALL_FIELD_KEYS = ["DATE", "PAYEE", "AMOUNT_NUMERIC", "AMOUNT_WORDS", "PURPOSE", "SAYAD_ID", "ACCOUNT_INFO", "CUSTOM_TEXT"];

export function AddFieldForm({ templateId, existingKeys }: { templateId: string; existingKeys: string[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createChequePrintTemplateField, null);
  const available = ALL_FIELD_KEYS.filter((k) => k === "CUSTOM_TEXT" || !existingKeys.includes(k));
  if (available.length === 0) return null;

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-paper-line p-3">
      <input type="hidden" name="template_id" value={templateId} />
      <Field label="فیلد جدید">
        <select name="field_key" className="input" defaultValue={available[0]}>
          {available.map((k) => (
            <option key={k} value={k}>
              {FIELD_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="X (mm)">
        <input name="x_mm" type="number" step="0.1" defaultValue={0} dir="ltr" className="input w-20 text-center tnum" />
      </Field>
      <Field label="Y (mm)">
        <input name="y_mm" type="number" step="0.1" defaultValue={0} dir="ltr" className="input w-20 text-center tnum" />
      </Field>
      <Field label="عرض (mm)">
        <input name="width_mm" type="number" step="0.1" defaultValue={30} dir="ltr" className="input w-20 text-center tnum" />
      </Field>
      <Field label="ارتفاع (mm)">
        <input name="height_mm" type="number" step="0.1" defaultValue={8} dir="ltr" className="input w-20 text-center tnum" />
      </Field>
      <SubmitButton variant="ghost">افزودن فیلد</SubmitButton>
      {state?.error && <FormError message={state.error} />}
    </form>
  );
}

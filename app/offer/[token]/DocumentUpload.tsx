"use client";

import { useActionState } from "react";
import { uploadTradeDocument, type ActionState } from "./actions";
import { FormError, SubmitButton } from "@/components/form";
import { TRADE_DOCUMENT_TYPE, TRADE_DOCUMENT_TYPE_LABEL } from "@/lib/enums";

export function DocumentUpload({ token, disabled }: { token: string; disabled: boolean }) {
  const boundAction = uploadTradeDocument.bind(null, token);
  const [state, formAction] = useActionState<ActionState, FormData>(boundAction, null);

  if (disabled) {
    return (
      <div className="card p-4">
        <p className="text-sm text-ink-muted">مهلت ارسال LOI/ICPO برای این آفر به پایان رسیده است.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-3 p-4">
      <p className="text-sm font-medium text-ink">بارگذاری LOI یا ICPO</p>
      <FormError message={state?.error} />
      {state?.ok && <p className="text-sm text-status-received">مدرک شما با موفقیت دریافت شد.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">نوع مدرک</span>
          <select name="document_type" required className="input">
            {TRADE_DOCUMENT_TYPE.map((t) => (<option key={t} value={t}>{TRADE_DOCUMENT_TYPE_LABEL[t]}</option>))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">فایل (PDF یا DOCX، حداکثر ۱۰ مگابایت)</span>
          <input type="file" name="file" required accept=".pdf,.docx" className="input" />
        </label>
      </div>
      <SubmitButton variant="seal">بارگذاری مدرک</SubmitButton>
    </form>
  );
}

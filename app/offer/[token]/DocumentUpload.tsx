"use client";

import { useActionState, useRef, useState } from "react";
import { uploadTradeDocument, type UploadActionState } from "./actions";
import { FormError, SubmitButton } from "@/components/form";
import { formatJalali } from "@/lib/jalali";
import { TRADE_DOCUMENT_TYPE, TRADE_DOCUMENT_TYPE_LABEL } from "@/lib/enums";

export function DocumentUpload({ token }: { token: string }) {
  const boundAction = uploadTradeDocument.bind(null, token);
  const [state, formAction] = useActionState<UploadActionState, FormData>(boundAction, null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  if (state?.ok) {
    return (
      <div className="card border-status-received/40 bg-status-received/5 p-4">
        <p className="text-sm font-medium text-ink">مدرک شما با موفقیت دریافت شد.</p>
        <dl className="mt-2 space-y-1 text-xs text-ink-muted">
          <div className="flex justify-between"><dt>نام فایل</dt><dd className="text-ink">{state.fileName}</dd></div>
          <div className="flex justify-between"><dt>نوع مدرک</dt><dd className="text-ink">{TRADE_DOCUMENT_TYPE_LABEL[state.documentType as "LOI" | "ICPO"] ?? state.documentType}</dd></div>
          <div className="flex justify-between"><dt>زمان دریافت</dt><dd className="tnum text-ink">{state.uploadedAt ? formatJalali(state.uploadedAt) : "—"}</dd></div>
        </dl>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-3 p-4">
      <p className="text-sm font-medium text-ink">بارگذاری LOI یا ICPO</p>
      <FormError message={state?.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">نوع مدرک</span>
          <select name="document_type" required className="input">
            {TRADE_DOCUMENT_TYPE.map((t) => (<option key={t} value={t}>{TRADE_DOCUMENT_TYPE_LABEL[t]}</option>))}
          </select>
        </label>
        <div className="block">
          <span className="field-label">فایل (PDF یا DOCX، حداکثر ۱۰ مگابایت)</span>
          <input
            ref={inputRef}
            type="file"
            name="file"
            required
            accept=".pdf,.docx"
            className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="btn-ghost shrink-0 text-sm">
              انتخاب فایل
            </button>
            <span className="truncate text-sm text-ink-muted">{fileName ?? "فایلی انتخاب نشده است"}</span>
          </div>
        </div>
      </div>
      <SubmitButton variant="seal">بارگذاری مدرک</SubmitButton>
    </form>
  );
}

"use client";

import { useActionState, useRef } from "react";
import { Paperclip, Upload } from "lucide-react";
import { uploadAttachment, type ActionState } from "@/app/actions/attachments";
import { FormError, SubmitButton } from "@/components/form";

export function AttachmentUploader({
  entityType,
  entityId,
  extraFields,
}: {
  entityType:
    | "CORRESPONDENCE" | "DOCUMENT" | "CASE" | "CONTRACT" | "SALES_DOCUMENT" | "COMPANY"
    | "OPPORTUNITY" | "PROJECT" | "TASK" | "CHEQUE" | "SERVICE_ENTRY" | "SERVICE_EXPENSE" | "PERSONNEL" | "BOARD_MEETING";
  entityId: string;
  /** Extra hidden fields the action needs — e.g. { company_id } for SERVICE_ENTRY/SERVICE_EXPENSE, whose ENTITY_MAP entry (app/actions/attachments.ts) reads a parentIdField to revalidate the right page (these entities live inside a company's tab, not their own top-level route). */
  extraFields?: Record<string, string>;
}) {
  const [state, action] = useActionState<ActionState, FormData>(uploadAttachment, null);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      {extraFields && Object.entries(extraFields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <FormError message={state?.error} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-ghost cursor-pointer">
          <Paperclip className="h-4 w-4" />
          انتخاب فایل
          <input
            ref={ref}
            type="file"
            name="file"
            className="hidden"
            accept=".pdf,.docx,.xlsx,.doc,.xls,image/png,image/jpeg,image/webp"
          />
        </label>
        <SubmitButton variant="primary">
          <Upload className="h-4 w-4" /> بارگذاری
        </SubmitButton>
        <span className="text-xs text-ink-muted">PDF, Word, Excel یا تصویر — حداکثر ۲۵ مگابایت</span>
      </div>
    </form>
  );
}

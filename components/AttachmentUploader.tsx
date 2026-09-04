"use client";

import { useActionState, useRef } from "react";
import { Paperclip, Upload } from "lucide-react";
import { uploadAttachment, type ActionState } from "@/app/actions/attachments";
import { FormError, SubmitButton } from "@/components/form";

export function AttachmentUploader({
  entityType,
  entityId,
}: {
  entityType: "CORRESPONDENCE" | "DOCUMENT" | "CASE" | "CONTRACT" | "SALES_DOCUMENT";
  entityId: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(uploadAttachment, null);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
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

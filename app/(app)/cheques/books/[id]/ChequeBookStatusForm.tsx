"use client";

import { useActionState } from "react";
import { setChequeBookStatus, type ActionState } from "@/app/actions/cheques";
import { FormError, SubmitButton } from "@/components/form";

const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"] as const;
const LABEL: Record<(typeof STATUSES)[number], string> = { ACTIVE: "فعال", COMPLETED: "تکمیل‌شده", CANCELLED: "لغوشده", ARCHIVED: "بایگانی‌شده" };

export function ChequeBookStatusForm({ bookId, currentStatus }: { bookId: string; currentStatus: string }) {
  const [state, action] = useActionState<ActionState, FormData>(setChequeBookStatus, null);
  return (
    <form action={action} className="space-y-3">
      <FormError message={state?.error} />
      <input type="hidden" name="id" value={bookId} />
      <select name="status" defaultValue={currentStatus} className="input">
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABEL[s]}
          </option>
        ))}
      </select>
      <SubmitButton variant="ghost">تغییر وضعیت</SubmitButton>
    </form>
  );
}

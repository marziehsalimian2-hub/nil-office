"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send, Clock, XCircle, Reply, FileCheck2, FileDown } from "lucide-react";
import {
  finalizeOutgoing,
  sendForReview,
  cancelLetter,
  setStatus,
  createReplyDraft,
  type ActionState,
} from "@/app/actions/correspondence";
import { FormError } from "@/components/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function DetailActions({
  id,
  direction,
  status,
  hasNumber,
}: {
  id: string;
  direction: "OUTGOING" | "INCOMING";
  status: string;
  hasNumber: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(action: Action, fields: Record<string, string>) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  const editable = status === "DRAFT" || status === "REVIEW";
  const active = !["CANCELLED", "CLOSED"].includes(status);

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {direction === "OUTGOING" && (
          <a
            href={`/api/correspondence/${id}/pdf`}
            target="_blank"
            rel="noopener"
            className="btn-ghost"
          >
            <FileDown className="h-4 w-4" /> دانلود PDF (پیش‌نمایش)
          </a>
        )}

        {direction === "OUTGOING" && editable && !hasNumber && (
          <>
            {status === "DRAFT" && (
              <button disabled={pending} className="btn-ghost" onClick={() => run(sendForReview, { id })}>
                <FileCheck2 className="h-4 w-4" /> ارسال برای بررسی
              </button>
            )}
            <button disabled={pending} className="btn-seal" onClick={() => run(finalizeOutgoing, { id })}>
              <CheckCircle2 className="h-4 w-4" /> ثبت نهایی و اخذ شماره
            </button>
          </>
        )}

        {direction === "INCOMING" && (
          <button disabled={pending} className="btn-seal" onClick={() => run(createReplyDraft, { incoming_id: id })}>
            <Reply className="h-4 w-4" /> پاسخ به این نامه
          </button>
        )}

        {hasNumber && active && status !== "SENT" && direction === "OUTGOING" && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(setStatus, { id, status: "SENT" })}>
            <Send className="h-4 w-4" /> ثبت ارسال
          </button>
        )}

        {hasNumber && active && status !== "WAITING_RESPONSE" && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(setStatus, { id, status: "WAITING_RESPONSE" })}>
            <Clock className="h-4 w-4" /> در انتظار پاسخ
          </button>
        )}

        {hasNumber && active && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(setStatus, { id, status: "CLOSED" })}>
            بستن پرونده نامه
          </button>
        )}

        {hasNumber && status !== "CANCELLED" && (
          <button
            disabled={pending}
            className="btn-ghost text-status-cancelled"
            onClick={() => {
              if (confirm("آیا از ابطال این نامه مطمئن هستید؟ شماره حفظ می‌شود ولی نامه باطل می‌گردد.")) {
                run(cancelLetter, { id });
              }
            }}
          >
            <XCircle className="h-4 w-4" /> ابطال نامه
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileCheck2, PlayCircle, PauseCircle, Ban, XCircle, Undo2 } from "lucide-react";
import {
  sendContractForReview,
  returnContractToDraft,
  approveContract,
  activateContract,
  suspendContract,
  resumeContract,
  completeContract,
  terminateContract,
  cancelContract,
  type ActionState,
} from "@/app/actions/contracts";
import { FormError } from "@/components/form";
import type { ContractStatus } from "@/lib/enums";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ContractActions({ id, status }: { id: string; status: ContractStatus }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(action: Action, fields: Record<string, string> = {}) {
    const fd = new FormData();
    fd.append("id", id);
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

  function runWithReason(action: Action, promptLabel: string) {
    const reason = window.prompt(promptLabel) ?? "";
    run(action, { reason });
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(sendContractForReview)}>
              <FileCheck2 className="h-4 w-4" /> ارسال برای بررسی
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(cancelContract)}>
              <XCircle className="h-4 w-4" /> ابطال
            </button>
          </>
        )}

        {status === "UNDER_REVIEW" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(returnContractToDraft)}>
              <Undo2 className="h-4 w-4" /> بازگشت به پیش‌نویس
            </button>
            <button disabled={pending} className="btn-seal" onClick={() => run(approveContract)}>
              <CheckCircle2 className="h-4 w-4" /> تأیید و اخذ شماره
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(cancelContract)}>
              <XCircle className="h-4 w-4" /> ابطال
            </button>
          </>
        )}

        {status === "APPROVED" && (
          <>
            <button disabled={pending} className="btn-seal" onClick={() => run(activateContract)}>
              <PlayCircle className="h-4 w-4" /> فعال‌سازی
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(cancelContract)}>
              <XCircle className="h-4 w-4" /> ابطال
            </button>
          </>
        )}

        {status === "ACTIVE" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(suspendContract)}>
              <PauseCircle className="h-4 w-4" /> تعلیق
            </button>
            <button disabled={pending} className="btn-seal" onClick={() => run(completeContract)}>
              <CheckCircle2 className="h-4 w-4" /> تکمیل قرارداد
            </button>
            <button
              disabled={pending}
              className="btn-ghost text-status-cancelled"
              onClick={() => runWithReason(terminateContract, "دلیل فسخ (اختیاری):")}
            >
              <Ban className="h-4 w-4" /> فسخ
            </button>
          </>
        )}

        {status === "SUSPENDED" && (
          <>
            <button disabled={pending} className="btn-seal" onClick={() => run(resumeContract)}>
              <PlayCircle className="h-4 w-4" /> ازسرگیری
            </button>
            <button
              disabled={pending}
              className="btn-ghost text-status-cancelled"
              onClick={() => runWithReason(terminateContract, "دلیل فسخ (اختیاری):")}
            >
              <Ban className="h-4 w-4" /> فسخ
            </button>
          </>
        )}
      </div>
    </div>
  );
}

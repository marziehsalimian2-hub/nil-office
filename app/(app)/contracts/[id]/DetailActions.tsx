"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileCheck2, XCircle, PlayCircle, PauseCircle, StopCircle, Undo2, FileDown } from "lucide-react";
import {
  setContractStatus,
  approveContract,
  activateContract,
  cancelContract,
  type ActionState,
} from "@/app/actions/contracts";
import { FormError } from "@/components/form";
import type { ContractKind, ContractStatus } from "@/lib/enums";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function DetailActions({ id, status, kind }: { id: string; status: ContractStatus; kind: ContractKind }) {
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

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <a href={`/api/contracts/${id}/pdf`} target="_blank" rel="noopener" className="btn-ghost">
          <FileDown className="h-4 w-4" /> دانلود برگ خلاصهٔ قرارداد (PDF)
        </a>

        {status === "DRAFT" && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(setContractStatus, { id, status: "UNDER_REVIEW" })}>
            <FileCheck2 className="h-4 w-4" /> ارسال برای بررسی
          </button>
        )}

        {status === "UNDER_REVIEW" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(setContractStatus, { id, status: "DRAFT" })}>
              <Undo2 className="h-4 w-4" /> بازگشت به پیش‌نویس
            </button>
            {kind === "NIL_ISSUED" ? (
              <button disabled={pending} className="btn-seal" onClick={() => run(approveContract, { id })}>
                <CheckCircle2 className="h-4 w-4" /> تأیید و صدور شماره
              </button>
            ) : (
              <button disabled={pending} className="btn-seal" onClick={() => run(setContractStatus, { id, status: "APPROVED" })}>
                <CheckCircle2 className="h-4 w-4" /> تأیید قرارداد سابق
              </button>
            )}
          </>
        )}

        {status === "APPROVED" && (
          <button disabled={pending} className="btn-seal" onClick={() => run(activateContract, { id })}>
            <PlayCircle className="h-4 w-4" /> فعال‌سازی قرارداد
          </button>
        )}

        {status === "ACTIVE" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(setContractStatus, { id, status: "SUSPENDED" })}>
              <PauseCircle className="h-4 w-4" /> تعلیق
            </button>
            <button disabled={pending} className="btn-ghost" onClick={() => run(setContractStatus, { id, status: "COMPLETED" })}>
              <CheckCircle2 className="h-4 w-4" /> تکمیل قرارداد
            </button>
            <button disabled={pending} className="btn-ghost" onClick={() => run(setContractStatus, { id, status: "EXPIRED" })}>
              انقضا
            </button>
            <button
              disabled={pending}
              className="btn-ghost text-status-cancelled"
              onClick={() => run(setContractStatus, { id, status: "TERMINATED" })}
            >
              <StopCircle className="h-4 w-4" /> فسخ قرارداد
            </button>
          </>
        )}

        {status === "SUSPENDED" && (
          <>
            <button disabled={pending} className="btn-seal" onClick={() => run(setContractStatus, { id, status: "ACTIVE" })}>
              <PlayCircle className="h-4 w-4" /> از سرگیری
            </button>
            <button
              disabled={pending}
              className="btn-ghost text-status-cancelled"
              onClick={() => run(setContractStatus, { id, status: "TERMINATED" })}
            >
              <StopCircle className="h-4 w-4" /> فسخ قرارداد
            </button>
          </>
        )}

        {["DRAFT", "UNDER_REVIEW", "APPROVED"].includes(status) && (
          <button
            disabled={pending}
            className="btn-ghost text-status-cancelled"
            onClick={() => {
              if (confirm("آیا از ابطال این قرارداد مطمئن هستید؟")) run(cancelContract, { id });
            }}
          >
            <XCircle className="h-4 w-4" /> ابطال قرارداد
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PlayCircle, PauseCircle, StopCircle, Archive, Receipt } from "lucide-react";
import { setProjectStatus, finalizeProject, createProformaFromProject, type ActionState } from "@/app/actions/projects";
import { FormError } from "@/components/form";
import type { ProjectStatus } from "@/lib/enums";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function DetailActions({
  id,
  status,
  hasInvoiceAccess,
}: {
  id: string;
  status: ProjectStatus;
  hasInvoiceAccess: boolean;
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

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {hasInvoiceAccess && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(createProformaFromProject, { project_id: id })}>
            <Receipt className="h-4 w-4" /> صدور پیش‌فاکتور
          </button>
        )}

        {status === "DRAFT" && (
          <button disabled={pending} className="btn-seal" onClick={() => run(finalizeProject, { id })}>
            <CheckCircle2 className="h-4 w-4" /> تأیید و صدور شماره
          </button>
        )}
        {status === "DRAFT" && (
          <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(setProjectStatus, { id, status: "CANCELLED" })}>
            <StopCircle className="h-4 w-4" /> لغو پروژه
          </button>
        )}

        {status === "PLANNED" && (
          <>
            <button disabled={pending} className="btn-seal" onClick={() => run(setProjectStatus, { id, status: "ACTIVE" })}>
              <PlayCircle className="h-4 w-4" /> فعال‌سازی
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(setProjectStatus, { id, status: "CANCELLED" })}>
              <StopCircle className="h-4 w-4" /> لغو پروژه
            </button>
          </>
        )}

        {status === "ACTIVE" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(setProjectStatus, { id, status: "ON_HOLD" })}>
              <PauseCircle className="h-4 w-4" /> توقف موقت
            </button>
            <button disabled={pending} className="btn-seal" onClick={() => run(setProjectStatus, { id, status: "COMPLETED" })}>
              <CheckCircle2 className="h-4 w-4" /> تکمیل پروژه
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(setProjectStatus, { id, status: "CANCELLED" })}>
              <StopCircle className="h-4 w-4" /> لغو پروژه
            </button>
          </>
        )}

        {status === "ON_HOLD" && (
          <>
            <button disabled={pending} className="btn-seal" onClick={() => run(setProjectStatus, { id, status: "ACTIVE" })}>
              <PlayCircle className="h-4 w-4" /> از سرگیری
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(setProjectStatus, { id, status: "CANCELLED" })}>
              <StopCircle className="h-4 w-4" /> لغو پروژه
            </button>
          </>
        )}

        {(status === "COMPLETED" || status === "CANCELLED") && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(setProjectStatus, { id, status: "ARCHIVED" })}>
            <Archive className="h-4 w-4" /> بایگانی
          </button>
        )}
      </div>
    </div>
  );
}

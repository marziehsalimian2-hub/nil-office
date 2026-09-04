"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, FileCheck2, XCircle, PlayCircle, Undo2, FileDown, Pencil, ArrowRightLeft } from "lucide-react";
import {
  setSalesDocumentStatus,
  issueSalesDocument,
  convertProformaToInvoice,
  cancelSalesDocument,
  type ActionState,
} from "@/app/actions/invoices";
import { FormError } from "@/components/form";
import type { SalesDocumentStatus, SalesDocumentType } from "@/lib/enums";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function DetailActions({
  id,
  status,
  type,
}: {
  id: string;
  status: SalesDocumentStatus;
  type: SalesDocumentType;
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

  const canEdit = status === "DRAFT" || status === "REVIEW";
  const canCancel = !["CANCELLED", "CONVERTED", "SETTLED"].includes(status);

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noopener" className="btn-ghost">
          <FileDown className="h-4 w-4" /> دانلود PDF
        </a>

        {canEdit && (
          <Link href={`/invoices/${id}/edit`} className="btn-ghost">
            <Pencil className="h-4 w-4" /> ویرایش
          </Link>
        )}

        {status === "DRAFT" && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(setSalesDocumentStatus, { id, status: "REVIEW" })}>
            <FileCheck2 className="h-4 w-4" /> ارسال برای بررسی
          </button>
        )}

        {status === "REVIEW" && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => run(setSalesDocumentStatus, { id, status: "DRAFT" })}>
              <Undo2 className="h-4 w-4" /> بازگشت به پیش‌نویس
            </button>
            <button disabled={pending} className="btn-seal" onClick={() => run(setSalesDocumentStatus, { id, status: "APPROVED" })}>
              <CheckCircle2 className="h-4 w-4" /> تأیید
            </button>
          </>
        )}

        {status === "APPROVED" && (
          <button disabled={pending} className="btn-seal" onClick={() => run(issueSalesDocument, { id })}>
            <CheckCircle2 className="h-4 w-4" /> صدور و اخذ شماره
          </button>
        )}

        {type === "PROFORMA" && (status === "ISSUED" || status === "ACCEPTED") && (
          <>
            {status === "ISSUED" && (
              <button disabled={pending} className="btn-ghost" onClick={() => run(setSalesDocumentStatus, { id, status: "ACCEPTED" })}>
                <CheckCircle2 className="h-4 w-4" /> پذیرش توسط مشتری
              </button>
            )}
            <button disabled={pending} className="btn-ghost" onClick={() => run(setSalesDocumentStatus, { id, status: "EXPIRED" })}>
              انقضا
            </button>
            <button disabled={pending} className="btn-seal" onClick={() => run(convertProformaToInvoice, { id })}>
              <ArrowRightLeft className="h-4 w-4" /> تبدیل به فاکتور
            </button>
          </>
        )}

        {type === "INVOICE" && ["ISSUED", "PARTIALLY_SETTLED", "OVERDUE"].includes(status) && (
          <>
            {status !== "PARTIALLY_SETTLED" && (
              <button disabled={pending} className="btn-ghost" onClick={() => run(setSalesDocumentStatus, { id, status: "PARTIALLY_SETTLED" })}>
                <PlayCircle className="h-4 w-4" /> تسویهٔ جزئی
              </button>
            )}
            <button disabled={pending} className="btn-seal" onClick={() => run(setSalesDocumentStatus, { id, status: "SETTLED" })}>
              <CheckCircle2 className="h-4 w-4" /> تسویهٔ کامل
            </button>
            {status !== "OVERDUE" && (
              <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => run(setSalesDocumentStatus, { id, status: "OVERDUE" })}>
                معوق
              </button>
            )}
          </>
        )}

        {canCancel && (
          <button
            disabled={pending}
            className="btn-ghost text-status-cancelled"
            onClick={() => {
              if (confirm("آیا از ابطال این سند مطمئن هستید؟")) run(cancelSalesDocument, { id });
            }}
          >
            <XCircle className="h-4 w-4" /> ابطال
          </button>
        )}
      </div>
    </div>
  );
}

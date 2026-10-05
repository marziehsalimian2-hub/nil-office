"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPayrollAccountingDraft, discardPayrollAccountingDraft } from "@/app/actions/payroll-approval";
import { FormError } from "@/components/form";
import { POSTING_STATUS_LABEL, type PostingStatus } from "@/lib/enums";
import { accountingBlockers, type AccountingReadiness } from "@/lib/payroll/review";

const BLOCKER_TEXT: Record<string, string> = {
  CURRENCY_NOT_BASE: "واحد پول این دسته با واحد دفتر یکسان نیست؛ ساخت سند مجاز نیست. برای حقوق تومانی، «واحد نمایش» حسابداری را در تنظیمات روی «تومان» بگذارید (هیچ تبدیل ریال/تومانی انجام نمی‌شود).",
  SETTINGS_MISSING: "حساب هزینهٔ حقوق پایه و حساب حقوق پرداختنی هنوز مشخص نشده است.",
  COMPONENTS_UNMAPPED: "برای برخی اجزا حساب مشخص نشده است.",
};

/** Accounting draft (never posted from here). The journal link is shown only to users who can open Accounting. */
export function AccountingCard({
  batchId, readiness, canDraft, canOpenAccounting, canAdminPayroll,
}: { batchId: string; readiness: AccountingReadiness; canDraft: boolean; canOpenAccounting: boolean; canAdminPayroll: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const blockers = accountingBlockers(readiness);
  const j = readiness.journal;

  function create() {
    const fd = new FormData();
    fd.set("batch_id", batchId);
    start(async () => {
      const r = await createPayrollAccountingDraft(null, fd);
      if (r?.error) setError(r.error);
      else { setError(undefined); router.refresh(); }
    });
  }

  function discard() {
    if (!window.confirm("سند پیش‌نویس حذف شود؟ می‌توانید بعداً دوباره بسازید.")) return;
    const fd = new FormData();
    fd.set("batch_id", batchId);
    start(async () => {
      const r = await discardPayrollAccountingDraft(null, fd);
      if (r?.error) setError(r.error);
      else { setError(undefined); router.refresh(); }
    });
  }

  return (
    <div className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold text-ink">سند حسابداری</h2>
      <FormError message={error} />
      {j && (
        <p className="text-sm text-ink">
          سند حسابداری {POSTING_STATUS_LABEL[j.status as PostingStatus] ?? j.status}
          {j.document_number ? ` — شمارهٔ ${j.document_number}` : ""}
          {canOpenAccounting && (
            <> — <Link href={`/accounting/journal/${j.id}`} className="text-seal hover:underline">مشاهده در حسابداری</Link></>
          )}
        </p>
      )}
      {j?.status === "DRAFT" && canDraft && (
        <button type="button" className="btn-quiet" disabled={busy} onClick={discard}>حذف سند پیش‌نویس</button>
      )}
      {readiness.can_draft ? (
        <>
          {blockers.length > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-sm text-status-cancelled">
              {blockers.map((b) => (<li key={b}>{BLOCKER_TEXT[b]}</li>))}
              {readiness.missing_components.length > 0 && (
                <li className="list-none text-ink-muted">
                  اجزای بدون حساب: {readiness.missing_components.map((c) => c.name || c.code).join("، ")}
                </li>
              )}
            </ul>
          )}
          {blockers.length > 0 && canAdminPayroll && (
            <Link href="/payroll/accounting" className="btn-quiet inline-flex">تنظیم حساب‌ها</Link>
          )}
          <button type="button" className="btn-primary" disabled={busy || blockers.length > 0 || !canDraft} onClick={create}>
            ساخت سند حسابداری (پیش‌نویس)
          </button>
          {!canDraft && <p className="text-xs text-ink-muted">ساخت سند، هم دسترسی «تأیید» در حقوق و هم دسترسی «ثبت» در حسابداری می‌خواهد.</p>}
          <p className="text-xs text-ink-muted">سند فقط به‌صورت پیش‌نویس و تجمیعی (بر اساس جزء، نه فرد) ساخته می‌شود؛ ثبت قطعی در حسابداری و با دسترسی خودش انجام می‌شود.</p>
        </>
      ) : (
        !j && <p className="text-sm text-ink-muted">سند حسابداری پس از تأیید نهایی قابل ساخت است.</p>
      )}
    </div>
  );
}

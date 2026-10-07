"use client";

import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/form";
import {
  retryDocumentVerification, revokeVerificationAction, supersedeVerificationAction, type VerifyActionState,
} from "@/app/actions/verify";
import type { VerifyDocumentType } from "@/lib/verify/types";

const Msg = ({ s }: { s: VerifyActionState }) =>
  s?.ok ? <p className="text-xs text-status-final">{s.message}</p> : <FormError message={s?.error} />;

/** PENDING: the number was issued but the QR PDF / hash / storage step did not finish. Idempotent retry. */
export function RetryVerificationForm({ type, documentId, revalidate }: { type: VerifyDocumentType; documentId: string; revalidate: string }) {
  const [state, action] = useActionState<VerifyActionState, FormData>(retryDocumentVerification, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={documentId} />
      <input type="hidden" name="revalidate" value={revalidate} />
      <SubmitButton variant="seal">تلاش مجدد صدور کد استعلام</SubmitButton>
      <Msg s={state} />
    </form>
  );
}

/** ADMIN: revoke (reason required). The database re-checks is_admin(). */
export function RevokeVerificationForm({ verificationId, revalidate }: { verificationId: string; revalidate: string }) {
  const [state, action] = useActionState<VerifyActionState, FormData>(revokeVerificationAction, null);
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={(e) => { if (!window.confirm("استعلام این سند ابطال شود؟ QR باقی می‌ماند ولی وضعیت «ابطال‌شده» نمایش داده می‌شود.")) e.preventDefault(); }}
    >
      <input type="hidden" name="verification_id" value={verificationId} />
      <input type="hidden" name="revalidate" value={revalidate} />
      <label className="block text-xs text-ink-muted">دلیل ابطال (الزامی)
        <input name="reason" required minLength={3} maxLength={500} className="input mt-1" />
      </label>
      <SubmitButton variant="ghost">ابطال استعلام</SubmitButton>
      <Msg s={state} />
    </form>
  );
}

/** ADMIN: mark this verification as superseded by another ACTIVE verification of the same document type. */
export function SupersedeVerificationForm({
  verificationId, candidates, revalidate,
}: { verificationId: string; candidates: { id: string; code: string; document_number: string }[]; revalidate: string }) {
  const [state, action] = useActionState<VerifyActionState, FormData>(supersedeVerificationAction, null);
  if (candidates.length === 0) return <p className="text-xs text-ink-muted">سند فعال دیگری از همین نوع برای جایگزینی وجود ندارد.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="old_id" value={verificationId} />
      <input type="hidden" name="revalidate" value={revalidate} />
      <label className="block text-xs text-ink-muted">جایگزین‌شده با سند
        <select name="new_id" required className="input mt-1" defaultValue="">
          <option value="" disabled>انتخاب کنید…</option>
          {candidates.map((c) => (<option key={c.id} value={c.id}>{c.document_number} — {c.code}</option>))}
        </select>
      </label>
      <label className="block text-xs text-ink-muted">دلیل (الزامی)
        <input name="reason" required minLength={3} maxLength={500} className="input mt-1" />
      </label>
      <SubmitButton variant="ghost">ثبت به‌عنوان جایگزین‌شده</SubmitButton>
      <Msg s={state} />
    </form>
  );
}

import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { getVerifyStatus } from "@/lib/verify/frozen";
import { VERIFY_STATUS_LABEL, type VerifyDocumentType } from "@/lib/verify/types";
import { shortHash } from "@/lib/verify/format";
import { RetryVerificationForm, RevokeVerificationForm, SupersedeVerificationForm } from "./VerificationActions";

const TONE: Record<string, string> = {
  PENDING: "text-status-cancelled",
  ACTIVE: "text-status-final",
  REVOKED: "text-status-cancelled",
  SUPERSEDED: "text-status-waiting",
};

/**
 * NIL Verify card for a document's detail page. Shown only when a verification record exists (old documents are never verified
 * silently — no backfill). PENDING = the official number was issued but the QR-PDF step did not finish: a red banner + idempotent retry.
 * Revoke / supersede are ADMIN only (the database enforces it too). The public link is not shown: only its hash is stored, it exists inside the PDF's QR.
 */
export async function VerificationCard({
  type, documentId, isAdmin, revalidate,
}: { type: VerifyDocumentType; documentId: string; isAdmin: boolean; revalidate: string }) {
  const supabase = await createClient();
  const st = await getVerifyStatus(supabase, type, documentId);
  if (!st.exists) return null;

  let candidates: { id: string; code: string; document_number: string }[] = [];
  if (isAdmin && st.status === "ACTIVE") {
    const { data } = await supabase.rpc("verify_list_active", { p_type: type });
    candidates = ((data ?? []) as typeof candidates).filter((c) => c.id !== st.id);
  }

  return (
    <Card className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-ink">استعلام اصالت (NIL Verify)</h2>
        <span className={`text-sm font-medium ${TONE[st.status] ?? ""}`}>{VERIFY_STATUS_LABEL[st.status]}</span>
      </div>

      {st.status === "PENDING" && (
        <div className="mb-3 rounded-lg border border-status-cancelled/40 bg-status-cancelled/5 p-3 text-sm text-ink">
          <p className="mb-2">
            شمارهٔ رسمی صادر شده، ولی ساخت فایل نهایی دارای QR کامل نشد؛ تا آن زمان این سند «معتبر» اعلام نمی‌شود و QR فعال نیست.
          </p>
          <RetryVerificationForm type={type} documentId={documentId} revalidate={revalidate} />
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2"><dt className="text-ink-muted">کد استعلام:</dt><dd dir="ltr" className="tnum">{st.code}</dd></div>
        {st.activated_at && (<div className="flex gap-2"><dt className="text-ink-muted">تاریخ فعال‌سازی:</dt><dd className="tnum">{formatJalali(st.activated_at)}</dd></div>)}
        {st.hash_prefix && (<div className="flex gap-2"><dt className="text-ink-muted">اثر انگشت فایل (SHA-256):</dt><dd dir="ltr" className="tnum">{shortHash(st.hash_prefix)}…</dd></div>)}
        <div className="flex gap-2"><dt className="text-ink-muted">دفعات استعلام عمومی:</dt><dd className="tnum">{toFaDigits(st.verification_count)}</dd></div>
        {st.revoked_at && (<div className="flex gap-2"><dt className="text-ink-muted">تاریخ ابطال/جایگزینی:</dt><dd className="tnum">{formatJalali(st.revoked_at)}</dd></div>)}
      </dl>
      {st.status === "ACTIVE" && (
        <p className="mt-2 text-xs text-ink-muted">
          فایل PDF این سند «فریز» شده و همیشه همان نسخه (با QR) دانلود می‌شود؛ نسخهٔ «بدون مهر» برای چاپ و امضای دستی QR ندارد و با اثر انگشت ثبت‌شده مطابقت نمی‌کند.
        </p>
      )}

      {isAdmin && (st.status === "ACTIVE" || st.status === "PENDING") && (
        <details className="mt-4 rounded-lg border border-paper-line p-3">
          <summary className="cursor-pointer text-sm text-ink">اقدامات مدیر سامانه (ابطال / جایگزینی)</summary>
          <div className="mt-3 grid gap-6 sm:grid-cols-2">
            <RevokeVerificationForm verificationId={st.id} revalidate={revalidate} />
            {st.status === "ACTIVE" && <SupersedeVerificationForm verificationId={st.id} candidates={candidates} revalidate={revalidate} />}
          </div>
        </details>
      )}
    </Card>
  );
}

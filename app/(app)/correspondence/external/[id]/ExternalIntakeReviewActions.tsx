"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import {
  acceptAndRegisterExternalIntake,
  rejectExternalIntake,
  requestExternalIntakeInformation,
  assignExternalIntake,
  linkExternalIntakeCompany,
  linkExternalIntakeCase,
  createFollowupForExternalIntake,
} from "@/app/actions/external-correspondence";
import type { ExternalIntake } from "@/lib/types/database";

type Opt = { id: string; label: string };

const todayIsoClient = () => new Date().toISOString().slice(0, 10);

/**
 * All review actions in one client component — each a thin call to its
 * own server action, which itself is a thin call to the SECURITY
 * DEFINER function that does the real gating/transaction (migration
 * 0099). Accept & Register is the only genuinely irreversible one
 * (spec §65 — preview shown inline via the selected company/case
 * before the button is pressed, since there's no separate preview step
 * needed beyond seeing the same form's own selections).
 */
export function ExternalIntakeReviewActions({
  intake,
  profiles,
  companies,
  cases,
}: {
  intake: ExternalIntake;
  profiles: Opt[];
  companies: { id: string; legal_name: string }[];
  cases: { id: string; title: string; case_code: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const [companyId, setCompanyId] = useState(intake.company_id ?? "");
  const [caseId, setCaseId] = useState(intake.case_id ?? "");
  const [assignedTo, setAssignedTo] = useState(intake.assigned_to ?? "");

  const [showReject, setShowReject] = useState(false);
  const [internalReason, setInternalReason] = useState("");
  const [publicReason, setPublicReason] = useState("");

  const [showRequestInfo, setShowRequestInfo] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");

  const [showFollowup, setShowFollowup] = useState(false);
  const [followupTitle, setFollowupTitle] = useState("");

  const canAct = intake.status === "PENDING_REVIEW" || intake.status === "UNDER_REVIEW";
  const alreadyRegistered = !!intake.official_correspondence_id;

  function run(action: (prev: null, fd: FormData) => Promise<{ error?: string } | null>, fd: FormData, onSuccess?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function handleAssign() {
    const fd = new FormData();
    fd.append("intake_id", intake.id);
    if (assignedTo) fd.append("assigned_to", assignedTo);
    run(assignExternalIntake, fd);
  }

  function handleLinkCompany() {
    if (!companyId) return;
    const fd = new FormData();
    fd.append("intake_id", intake.id);
    fd.append("company_id", companyId);
    run(linkExternalIntakeCompany, fd);
  }

  function handleLinkCase() {
    if (!caseId) return;
    const fd = new FormData();
    fd.append("intake_id", intake.id);
    fd.append("case_id", caseId);
    run(linkExternalIntakeCase, fd);
  }

  function handleAcceptAndRegister() {
    if (!confirm("این مکاتبه به‌عنوان مکاتبهٔ وارده رسمی با شمارهٔ رسمی ثبت خواهد شد. ادامه می‌دهید؟")) return;
    const fd = new FormData();
    fd.append("intake_id", intake.id);
    fd.append("description", intake.description ?? "");
    if (companyId) fd.append("company_id", companyId);
    if (caseId) fd.append("case_id", caseId);
    if (assignedTo) fd.append("assigned_to", assignedTo);
    run(acceptAndRegisterExternalIntake, fd);
  }

  function handleReject() {
    if (!internalReason.trim()) return;
    const fd = new FormData();
    fd.append("intake_id", intake.id);
    fd.append("internal_reason", internalReason.trim());
    if (publicReason.trim()) fd.append("public_reason", publicReason.trim());
    run(rejectExternalIntake, fd, () => setShowReject(false));
  }

  function handleRequestInfo() {
    if (!infoMessage.trim()) return;
    const fd = new FormData();
    fd.append("intake_id", intake.id);
    fd.append("message", infoMessage.trim());
    run(requestExternalIntakeInformation, fd, () => setShowRequestInfo(false));
  }

  function handleCreateFollowup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.append("intake_id", intake.id);
    fd.append("correspondence_id", intake.official_correspondence_id ?? "");
    run(createFollowupForExternalIntake, fd, () => setShowFollowup(false));
  }

  return (
    <Card className="space-y-4">
      <p className="text-sm font-medium text-ink">اقدامات بررسی</p>
      <FormError message={error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="شرکت مرتبط">
          <div className="flex gap-2">
            <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— انتخاب نشده —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legal_name}
                </option>
              ))}
            </select>
            <button type="button" disabled={pending || !companyId} className="btn-quiet !py-1.5 text-xs" onClick={handleLinkCompany}>
              پیوند
            </button>
          </div>
        </Field>
        <Field label="پروندهٔ مرتبط">
          <div className="flex gap-2">
            <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">— انتخاب نشده —</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <button type="button" disabled={pending || !caseId} className="btn-quiet !py-1.5 text-xs" onClick={handleLinkCase}>
              پیوند
            </button>
          </div>
        </Field>
        <Field label="مسئول بررسی">
          <div className="flex gap-2">
            <select className="input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">— تعیین‌نشده —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button type="button" disabled={pending} className="btn-quiet !py-1.5 text-xs" onClick={handleAssign}>
              تعیین
            </button>
          </div>
        </Field>
      </div>

      {canAct && (
        <div className="flex flex-wrap gap-2 border-t border-paper-line pt-3">
          <button type="button" disabled={pending} className="btn-seal" onClick={handleAcceptAndRegister}>
            پذیرش و ثبت رسمی
          </button>
          <button type="button" disabled={pending} className="btn-quiet" onClick={() => setShowRequestInfo((v) => !v)}>
            درخواست اطلاعات تکمیلی
          </button>
          <button type="button" disabled={pending} className="btn-quiet text-status-cancelled" onClick={() => setShowReject((v) => !v)}>
            رد مکاتبه
          </button>
        </div>
      )}

      {showRequestInfo && (
        <div className="space-y-2 rounded-lg border border-paper-line bg-paper/40 p-3">
          <Field label="پیامی که برای فرستنده ارسال می‌شود" required>
            <textarea className="input" rows={3} value={infoMessage} onChange={(e) => setInfoMessage(e.target.value)} />
          </Field>
          <button type="button" disabled={pending} className="btn-primary !py-1.5 text-xs" onClick={handleRequestInfo}>
            ارسال درخواست
          </button>
        </div>
      )}

      {showReject && (
        <div className="space-y-2 rounded-lg border border-paper-line bg-paper/40 p-3">
          <Field label="دلیل داخلی رد (هرگز برای فرستنده نمایش داده نمی‌شود)" required>
            <textarea className="input" rows={2} value={internalReason} onChange={(e) => setInternalReason(e.target.value)} />
          </Field>
          <Field label="دلیل قابل‌نمایش به فرستنده (اختیاری)">
            <textarea className="input" rows={2} value={publicReason} onChange={(e) => setPublicReason(e.target.value)} />
          </Field>
          <button type="button" disabled={pending} className="btn-primary !py-1.5 text-xs text-status-cancelled" onClick={handleReject}>
            تأیید رد مکاتبه
          </button>
        </div>
      )}

      {alreadyRegistered && (
        <div className="border-t border-paper-line pt-3">
          {!showFollowup ? (
            <button type="button" className="btn-quiet text-xs" onClick={() => setShowFollowup(true)}>
              ایجاد پیگیری
            </button>
          ) : (
            <form onSubmit={handleCreateFollowup} className="space-y-2 rounded-lg border border-paper-line bg-paper/40 p-3">
              <Field label="عنوان پیگیری" required>
                <input name="title" required className="input" value={followupTitle} onChange={(e) => setFollowupTitle(e.target.value)} />
              </Field>
              <Field label="تاریخ سررسید" required>
                <JalaliDateInput name="due_date" defaultISO={todayIsoClient()} required />
              </Field>
              <div className="flex gap-2">
                <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-xs">
                  ثبت پیگیری
                </button>
                <button type="button" className="btn-quiet !py-1.5 text-xs" onClick={() => setShowFollowup(false)}>
                  انصراف
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

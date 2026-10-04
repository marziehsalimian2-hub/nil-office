"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEligibilityOverride } from "@/app/actions/payroll-runs";
import { FormError } from "@/components/form";
import { ELIGIBILITY_DECISION_LABEL, type EligibilityDecision } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { ReviewOverride, ReviewResult } from "@/lib/payroll/review";

export type PersonOption = { personnel_id: string; label: string };

/**
 * Eligibility is derived from employment records; only EXCEPTIONS are stored (APPROVE tier + reason).
 * Excluding a person who is currently in the batch, or including someone who is not, makes the batch stale until recalculated.
 */
export function EligibilityPanel({
  batchId, overrides, members, candidates, canOverride, editable,
}: { batchId: string; overrides: ReviewOverride[]; members: ReviewResult[]; candidates: PersonOption[]; canOverride: boolean; editable: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const [pid, setPid] = useState("");
  const [decision, setDecision] = useState<EligibilityDecision>("EXCLUDE");
  const [reason, setReason] = useState("");

  function submit(personnelId: string, d: EligibilityDecision, r: string) {
    const fd = new FormData();
    fd.set("batch_id", batchId);
    fd.set("personnel_id", personnelId);
    fd.set("decision", d);
    if (r.trim()) fd.set("reason", r.trim());
    start(async () => {
      const res = await setEligibilityOverride(null, fd);
      if (res?.error) setError(res.error);
      else { setError(undefined); setPid(""); setReason(""); router.refresh(); }
    });
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">استثناهای ثبت‌شده</h3>
        {overrides.length === 0 ? (
          <p className="text-sm text-ink-muted">استثنایی ثبت نشده؛ افراد مشمول از روی سوابق استخدام و واحد پول حقوق خودکار تعیین می‌شوند.</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="table-head"><th className="px-3 py-2 text-start">فرد</th><th className="px-3 py-2 text-start">تصمیم</th><th className="px-3 py-2 text-start">دلیل</th><th className="px-3 py-2 text-start">تاریخ</th><th /></tr></thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.personnel_id} className="table-row">
                    <td className="px-3 py-2">{o.personnel_name} <span className="tnum text-xs text-ink-muted">{o.personnel_number}</span></td>
                    <td className="px-3 py-2">{ELIGIBILITY_DECISION_LABEL[o.decision as EligibilityDecision] ?? o.decision}</td>
                    <td className="px-3 py-2 text-ink-muted">{o.reason ?? "—"}</td>
                    <td className="tnum px-3 py-2 text-ink-muted">{formatJalali(o.decided_at)}</td>
                    <td className="px-3 py-2">
                      {canOverride && editable && (
                        <button type="button" className="btn-quiet !py-1 text-xs" disabled={busy} onClick={() => submit(o.personnel_id, "AUTO", "")}>حذف استثنا</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canOverride && editable ? (
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold text-ink">استثنای جدید</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="">— فرد —</option>
              {decision === "EXCLUDE"
                ? members.map((m) => (<option key={m.personnel_id} value={m.personnel_id}>{m.personnel_name} ({m.personnel_number})</option>))
                : candidates.map((c) => (<option key={c.personnel_id} value={c.personnel_id}>{c.label}</option>))}
            </select>
            <select className="input" value={decision} onChange={(e) => { setDecision(e.target.value as EligibilityDecision); setPid(""); }}>
              <option value="EXCLUDE">{ELIGIBILITY_DECISION_LABEL.EXCLUDE}</option>
              <option value="INCLUDE">{ELIGIBILITY_DECISION_LABEL.INCLUDE}</option>
            </select>
            <input className="input" placeholder="دلیل (الزامی)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={busy || !pid || !reason.trim()} onClick={() => submit(pid, decision, reason)}>ثبت استثنا</button>
          <p className="text-xs text-ink-muted">«شمول اجباری» فقط برای افرادی است که خودکار مشمول نشده‌اند و پروفایل حقوقشان هم‌واحد با دسته است. پس از ثبت، دسته باید دوباره محاسبه شود.</p>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">{editable ? "ثبت یا حذف استثنا نیازمند دسترسی «تأیید» در حقوق و دستمزد است." : "در وضعیت فعلی دسته، استثنا قابل تغییر نیست."}</p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeLegalRuleSetStatus } from "@/app/actions/payroll-rules";
import { FormError } from "@/components/form";
import { LEGAL_RULE_SET_STATUS_LABEL, type LegalRuleSetStatus } from "@/lib/enums";

export type RuleTransition = { to: LegalRuleSetStatus; tier: "APPROVE" | "ADMIN" };

/** Shows only transitions the lookup table allows from the current status; the RPC re-checks tier and rules server-side. */
export function RuleSetStatusActions({
  id, transitions, canApprove, canAdmin,
}: { id: string; transitions: RuleTransition[]; canApprove: boolean; canAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [target, setTarget] = useState<LegalRuleSetStatus | null>(null);
  const [note, setNote] = useState("");

  const allowed = transitions.filter((t) => (t.tier === "ADMIN" ? canAdmin : canApprove));
  if (allowed.length === 0) {
    return <p className="text-xs text-ink-muted">برای تغییر وضعیت این مجموعه، دسترسی «تأیید» یا بالاتر لازم است.</p>;
  }

  function go(to: LegalRuleSetStatus) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("new_status", to);
    if (note.trim()) fd.set("note", note.trim());
    start(async () => {
      const r = await changeLegalRuleSetStatus(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(undefined);
        setTarget(null);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {allowed.map((t) => (
          <button key={t.to} type="button" disabled={pending}
            className={t.to === "APPROVED" ? "btn-seal" : "btn-quiet"}
            onClick={() => (t.to === "RETIRED" || t.to === "DRAFT" ? setTarget(t.to) : go(t.to))}>
            {t.to === "DRAFT" ? "بازگشت به پیش‌نویس" : `تغییر به «${LEGAL_RULE_SET_STATUS_LABEL[t.to]}»`}
          </button>
        ))}
      </div>
      {target && (
        <div className="space-y-2 rounded-lg border border-paper-line bg-paper/40 p-3">
          <p className="text-xs text-ink-muted">برای این تغییر، ذکر دلیل الزامی است.</p>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={pending || !note.trim()} className="btn-primary !py-1.5 text-xs" onClick={() => go(target)}>تأیید تغییر</button>
            <button type="button" className="btn-quiet !py-1.5 text-xs" onClick={() => { setTarget(null); setNote(""); }}>انصراف</button>
          </div>
        </div>
      )}
    </div>
  );
}

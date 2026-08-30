"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setAccountingRole } from "@/app/actions/accounting";
import { ACCOUNTING_ROLE, ACCOUNTING_ROLE_LABEL } from "@/lib/enums";
export function AccountingRoleSelect({ userId, current }: { userId: string; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  function change(value: string) {
    const fd = new FormData();
    fd.append("user_id", userId);
    if (value) fd.append("accounting_role", value);
    start(async () => {
      const r = await setAccountingRole(null, fd);
      if (r && "error" in r && r.error) setErr(r.error); else router.refresh();
    });
  }
  return (
    <div>
      <select disabled={pending} defaultValue={current ?? ""} onChange={(e) => change(e.target.value)} className="input !py-1.5 text-sm">
        <option value="">بدون دسترسی</option>
        {ACCOUNTING_ROLE.map((r) => (<option key={r} value={r}>{ACCOUNTING_ROLE_LABEL[r]}</option>))}
      </select>
      {err && <p className="mt-1 text-xs text-status-cancelled">{err}</p>}
    </div>
  );
}

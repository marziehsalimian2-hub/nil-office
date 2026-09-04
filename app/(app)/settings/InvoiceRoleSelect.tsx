"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setInvoiceRole } from "@/app/actions/invoices";
import { INVOICE_ROLE, INVOICE_ROLE_LABEL } from "@/lib/enums";
export function InvoiceRoleSelect({ userId, current }: { userId: string; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  function change(value: string) {
    const fd = new FormData();
    fd.append("user_id", userId);
    if (value) fd.append("invoice_role", value);
    start(async () => {
      const r = await setInvoiceRole(null, fd);
      if (r && "error" in r && r.error) setErr(r.error); else router.refresh();
    });
  }
  return (
    <div>
      <select disabled={pending} defaultValue={current ?? ""} onChange={(e) => change(e.target.value)} className="input !py-1.5 text-sm">
        <option value="">بدون دسترسی</option>
        {INVOICE_ROLE.map((r) => (<option key={r} value={r}>{INVOICE_ROLE_LABEL[r]}</option>))}
      </select>
      {err && <p className="mt-1 text-xs text-status-cancelled">{err}</p>}
    </div>
  );
}

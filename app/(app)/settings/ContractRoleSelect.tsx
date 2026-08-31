"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setContractRole } from "@/app/actions/contracts";
import { CONTRACT_ROLE, CONTRACT_ROLE_LABEL } from "@/lib/enums";
export function ContractRoleSelect({ userId, current }: { userId: string; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  function change(value: string) {
    const fd = new FormData();
    fd.append("user_id", userId);
    if (value) fd.append("contract_role", value);
    start(async () => {
      const r = await setContractRole(null, fd);
      if (r && "error" in r && r.error) setErr(r.error); else router.refresh();
    });
  }
  return (
    <div>
      <select disabled={pending} defaultValue={current ?? ""} onChange={(e) => change(e.target.value)} className="input !py-1.5 text-sm">
        <option value="">بدون دسترسی</option>
        {CONTRACT_ROLE.map((r) => (<option key={r} value={r}>{CONTRACT_ROLE_LABEL[r]}</option>))}
      </select>
      {err && <p className="mt-1 text-xs text-status-cancelled">{err}</p>}
    </div>
  );
}

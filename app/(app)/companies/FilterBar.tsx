"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CRM_COMPANY_STATUS, CRM_COMPANY_STATUS_LABEL, CRM_COMPANY_ROLE, CRM_COMPANY_ROLE_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function FilterBar({ profiles }: { profiles: Opt[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/companies?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <select className="input w-auto" value={searchParams.get("crm_status") ?? ""} onChange={(e) => set("crm_status", e.target.value)}>
        <option value="">همهٔ وضعیت‌ها</option>
        {CRM_COMPANY_STATUS.map((s) => (<option key={s} value={s}>{CRM_COMPANY_STATUS_LABEL[s]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("role") ?? ""} onChange={(e) => set("role", e.target.value)}>
        <option value="">همهٔ نقش‌ها</option>
        {CRM_COMPANY_ROLE.map((r) => (<option key={r} value={r}>{CRM_COMPANY_ROLE_LABEL[r]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("owner_user_id") ?? ""} onChange={(e) => set("owner_user_id", e.target.value)}>
        <option value="">همهٔ مالکان</option>
        {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
      </select>
    </div>
  );
}

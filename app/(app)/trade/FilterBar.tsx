"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { TRADE_OFFER_STATUS, TRADE_OFFER_STATUS_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function FilterBar({ buyers }: { buyers: Opt[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/trade?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <input
        className="input w-auto min-w-[200px]"
        placeholder="جستجو (عنوان، کد آفر، محصول)"
        defaultValue={searchParams.get("q") ?? ""}
        onKeyDown={(e) => { if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value); }}
        onBlur={(e) => set("q", e.target.value)}
      />
      <select className="input w-auto" value={searchParams.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">همهٔ وضعیت‌ها</option>
        {TRADE_OFFER_STATUS.map((s) => (<option key={s} value={s}>{TRADE_OFFER_STATUS_LABEL[s]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("buyer_company_id") ?? ""} onChange={(e) => set("buyer_company_id", e.target.value)}>
        <option value="">همهٔ خریداران</option>
        {buyers.map((b) => (<option key={b.id} value={b.id}>{b.label}</option>))}
      </select>
    </div>
  );
}

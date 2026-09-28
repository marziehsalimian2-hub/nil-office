"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setInternalCostRate } from "@/app/actions/internal-cost-rates";

export function CostRateRow({
  profileId,
  label,
  currentRate,
  currentCurrency,
}: {
  profileId: string;
  label: string;
  currentRate: number | null;
  currentCurrency: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setInternalCostRate(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  return (
    <tr className="table-row">
      <td className="px-4 py-3 text-ink">{label}</td>
      <td className="px-4 py-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input type="hidden" name="profile_id" value={profileId} />
          <input
            type="number"
            name="hourly_cost_rate"
            min={0}
            step="any"
            defaultValue={currentRate ?? ""}
            className="input tnum w-32"
            placeholder="تعیین‌نشده"
          />
          <select name="currency" defaultValue={currentCurrency} className="input w-24" dir="ltr">
            {["IRR", "TOMAN", "USD", "EUR", "AED", "TRY", "CNY"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className="btn-quiet px-3 py-1.5 text-xs">
            {pending ? "…" : "ذخیره"}
          </button>
        </form>
        {error && <p className="mt-1 text-xs text-status-cancelled">{error}</p>}
      </td>
    </tr>
  );
}

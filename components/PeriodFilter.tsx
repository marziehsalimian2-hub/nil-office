"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/service-ledger/period";
import { JalaliDateInput } from "@/components/JalaliDateInput";

const PRESET_LABEL: Record<PeriodPreset, string> = {
  this_month: "این ماه",
  prev_month: "ماه قبل",
  quarter: "فصل جاری",
  year: "سال جاری",
  custom: "بازهٔ دلخواه",
};

/**
 * Navigates via `?period=...&from=...&to=...` on the current path (mirrors
 * the existing `?tab=` filter convention already used by /invoices) —
 * no client-side data fetching here, the server page re-renders with the
 * new query string and resolves it authoritatively via resolvePeriod().
 * The custom range uses a real <form> (not local state) since
 * JalaliDateInput only exposes its resolved ISO value through a hidden
 * form field, matching how every other form in this app already reads it.
 */
export function PeriodFilter({ current }: { current: PeriodPreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setPreset(p: PeriodPreset) {
    if (p === "custom") return; // wait for the form below
    router.push(`${pathname}?period=${p}`);
  }

  function handleCustomSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const from = String(fd.get("from") ?? "");
    const to = String(fd.get("to") ?? "");
    if (!from || !to) return;
    router.push(`${pathname}?period=custom&from=${from}&to=${to}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIOD_PRESETS.filter((p) => p !== "custom").map((p) => (
        <button
          key={p}
          type="button"
          className={`btn-ghost !py-1.5 text-xs ${current === p ? "border-seal text-seal" : ""}`}
          onClick={() => setPreset(p)}
        >
          {PRESET_LABEL[p]}
        </button>
      ))}
      <form onSubmit={handleCustomSubmit} className="flex items-center gap-2">
        <JalaliDateInput name="from" defaultISO={searchParams.get("from")} />
        <span className="text-xs text-ink-muted">تا</span>
        <JalaliDateInput name="to" defaultISO={searchParams.get("to")} />
        <button type="submit" className={`btn-ghost !py-1.5 text-xs ${current === "custom" ? "border-seal text-seal" : ""}`}>
          اعمال بازه
        </button>
      </form>
    </div>
  );
}

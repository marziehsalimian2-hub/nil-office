import Link from "next/link";
import { Download } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import {
  CURRENCY, CURRENCY_LABEL, PERSONNEL_STATUS_LABEL, PERSONNEL_EMPLOYMENT_TYPE_LABEL,
} from "@/lib/enums";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import { toFaDigits } from "@/lib/jalali";
import type { ReportDef, FilterKey } from "@/lib/reports/definitions";
import { displayCell, type ReportRow } from "@/lib/reports/format";
import type { ReportParams } from "@/lib/reports/params";
import { PAGE_LIMIT, type LoadedReport } from "@/lib/reports/load";

export type PeriodOption = { id: string; jalali_year: number; jalali_month: number };
export type PersonOption = { id: string; number: string; name: string };

const FILTER_LABEL: Record<FilterKey, string> = {
  period: "دوره", currency: "واحد پول", from: "از دوره", to: "تا دوره", personnel: "فرد",
  status: "وضعیت", department: "واحد", employment_type: "نوع همکاری",
};
const EMPLOYMENT_RECORD_STATUS: Record<string, string> = { ACTIVE: "جاری", ENDED: "پایان‌یافته" };

function ReportTable({ cols, rows }: { cols: ReportDef["columns"]; rows: ReportRow[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm" style={{ minWidth: Math.max(640, cols.length * 110) }}>
        <thead>
          <tr className="table-head">
            {cols.map((c) => (<th key={c.key} className="px-3 py-2 text-start whitespace-nowrap">{c.label}</th>))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="table-row">
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "int" ? "tnum whitespace-nowrap" : ""} ${c.kind === "flags" && Array.isArray(r[c.key]) && (r[c.key] as unknown[]).length ? "text-status-cancelled" : ""}`}>
                  {displayCell(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generic report page body: filters (GET form) + CSV button + table + per-currency totals. Everything comes from the registry. */
export function ReportView({
  def, basePath, params, data, periods, people,
}: {
  def: ReportDef; basePath: string; params: ReportParams; data: LoadedReport; periods: PeriodOption[]; people: PersonOption[];
}) {
  const ymOf = (p: PeriodOption) => `${p.jalali_year}-${String(p.jalali_month).padStart(2, "0")}`;
  const qs = new URLSearchParams();
  for (const k of def.filters) if (params[k]) qs.set(k, params[k]!);
  const csvHref = `/api/reports/${def.key}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const canCsv = data.missing.length === 0 && !data.error;

  const select = (k: FilterKey) => {
    const common = { name: k, defaultValue: params[k] ?? "", className: "input" };
    switch (k) {
      case "period":
        return (<select {...common}><option value="">— انتخاب دوره —</option>{periods.map((p) => (<option key={p.id} value={p.id}>{jalaliMonthLabel(p.jalali_year, p.jalali_month)}</option>))}</select>);
      case "from":
      case "to":
        return (<select {...common}><option value="">—</option>{periods.map((p) => (<option key={ymOf(p)} value={ymOf(p)}>{jalaliMonthLabel(p.jalali_year, p.jalali_month)}</option>))}</select>);
      case "currency":
        return (<select {...common}><option value="">همه</option>{CURRENCY.map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}</select>);
      case "personnel":
        return (<select {...common}><option value="">{def.required?.includes("personnel") ? "— انتخاب فرد —" : "همه"}</option>{people.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.number})</option>))}</select>);
      case "status": {
        const opts = def.key === "hr_employment_history" ? EMPLOYMENT_RECORD_STATUS : (PERSONNEL_STATUS_LABEL as Record<string, string>);
        return (<select {...common}><option value="">همه</option>{Object.entries(opts).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}</select>);
      }
      case "employment_type":
        return (<select {...common}><option value="">همه</option>{Object.entries(PERSONNEL_EMPLOYMENT_TYPE_LABEL).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}</select>);
      case "department":
        return <input {...common} placeholder="بخشی از نام واحد" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{def.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{def.description}</p>
        </div>
        {canCsv && (
          <a href={csvHref} className="btn-seal" download>
            <Download className="h-4 w-4" /> خروجی CSV
          </a>
        )}
      </div>

      {def.filters.length > 0 && (
        <Card>
          <form method="get" className="flex flex-wrap items-end gap-3">
            {def.filters.map((k) => (
              <label key={k} className="block min-w-[10rem]">
                <span className="field-label">{FILTER_LABEL[k]}{def.required?.includes(k) ? " *" : ""}</span>
                {select(k)}
              </label>
            ))}
            <button type="submit" className="btn-primary">نمایش گزارش</button>
            <Link href={basePath} className="btn-quiet">پاک‌کردن فیلترها</Link>
          </form>
        </Card>
      )}

      {data.missing.length > 0 ? (
        <EmptyState title="برای دیدن این گزارش، فیلتر الزامی را انتخاب کنید." hint={`فیلتر الزامی: ${data.missing.map((k) => FILTER_LABEL[k as FilterKey] ?? k).join("، ")}`} />
      ) : data.error ? (
        <Card><p className="text-sm text-status-cancelled">بارگذاری گزارش ناموفق بود (دسترسی یا خطای داده). اگر دسترسی لازم را دارید دوباره تلاش کنید.</p></Card>
      ) : data.rows.length === 0 ? (
        <EmptyState title="داده‌ای برای این فیلترها پیدا نشد." />
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            {toFaDigits(data.rows.length)} ردیف{data.truncated ? ` — فقط ${toFaDigits(PAGE_LIMIT)} ردیف اول نمایش داده شد؛ برای همهٔ ردیف‌ها خروجی CSV بگیرید.` : ""}
            {" "}مبالغ هر واحد پول جدا هستند و هرگز با هم جمع نمی‌شوند.
          </p>
          <ReportTable cols={def.columns} rows={data.rows} />
          {def.totalsColumns && data.totals.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">جمع به تفکیک واحد پول</h2>
              <ReportTable cols={def.totalsColumns} rows={data.totals} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

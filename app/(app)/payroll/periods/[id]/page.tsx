import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, Card } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import {
  PAYROLL_BATCH_STATUS_LABEL, PAYROLL_BATCH_STATUS_TONE, CURRENCY_LABEL, PAYROLL_PERIOD_STATUS_LABEL, type Currency,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import type { PayrollPeriod, PayrollBatch } from "@/lib/types/database";
import type { WorkGridRow } from "@/lib/payroll/review";
import { WorkDataGrid } from "./WorkDataGrid";
import { NewBatchForm } from "./NewBatchForm";

export const dynamic = "force-dynamic";

export default async function PayrollPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const access = payrollAccess(profile);

  const { data: period } = await supabase.from("payroll_periods").select("*").eq("id", id).maybeSingle();
  if (!period) notFound();
  const p = period as PayrollPeriod;

  const [{ data: grid }, { data: batches }, { data: sets }] = await Promise.all([
    supabase.rpc("payroll_work_grid", { p_period_id: id, p_batch_id: null }),
    supabase.from("payroll_batches").select("*").eq("period_id", id).order("batch_number"),
    supabase.from("legal_rule_sets").select("jurisdiction"),
  ]);
  const rows = ((grid ?? []) as WorkGridRow[]).filter((r) => r.in_period || r.work_data);
  const bs = (batches ?? []) as PayrollBatch[];
  const live = bs.filter((b) => b.status !== "CANCELLED");
  const jurisdictions = [...new Set(((sets ?? []) as { jurisdiction: string }[]).map((s) => s.jurisdiction))].sort();

  const steps = [
    { label: "کارکرد", done: rows.some((r) => r.work_data) },
    { label: "دستهٔ محاسبه", done: live.length > 0 },
    { label: "محاسبه", done: live.some((b) => b.calculation_version > 0) },
    { label: "بررسی", done: live.some((b) => b.status === "UNDER_REVIEW") },
  ];

  const batchesTab = (
    <div className="space-y-5">
      {bs.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز دسته‌ای برای این دوره ساخته نشده است.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[560px]">
            <thead><tr className="table-head"><th className="px-4 py-3">شمارهٔ دسته</th><th className="px-4 py-3">واحد پول</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">محاسبه</th></tr></thead>
            <tbody>
              {bs.map((b) => (
                <tr key={b.id} className="table-row">
                  <td className="px-4 py-3"><Link href={`/payroll/batches/${b.id}`} className="tnum font-medium text-seal hover:underline">{b.batch_number}</Link></td>
                  <td className="px-4 py-3 text-ink-muted">{CURRENCY_LABEL[b.currency as Currency] ?? b.currency}</td>
                  <td className="px-4 py-3"><span className={`badge ${PAYROLL_BATCH_STATUS_TONE[b.status]}`}>{PAYROLL_BATCH_STATUS_LABEL[b.status]}</span></td>
                  <td className="px-4 py-3 tnum text-ink-muted">{b.calculation_version > 0 ? `نسخهٔ ${toFaDigits(b.calculation_version)} — ${formatJalali(b.calculated_at)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {access.create && p.status === "OPEN" && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">دستهٔ محاسبهٔ جدید</h2>
          <NewBatchForm periodId={p.id} jurisdictions={jurisdictions} usedCurrencies={live.map((b) => b.currency)} />
        </Card>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={`دورهٔ حقوقی ${jalaliMonthLabel(p.jalali_year, p.jalali_month)}`}
        subtitle={`${formatJalali(p.period_start)} تا ${formatJalali(p.period_end)} (هر دو روز جزو دوره) — ${PAYROLL_PERIOD_STATUS_LABEL[p.status]}`}
        action={<Link href="/payroll/periods" className="btn-quiet">همهٔ دوره‌ها</Link>}
      />
      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s.label} className={`badge ${s.done ? "status-final" : "status-draft"}`}>{toFaDigits(i + 1)}. {s.label}{s.done ? " ✓" : ""}</li>
        ))}
      </ol>
      <Tabs tabs={[
        { label: "کارکرد", content: <WorkDataGrid key={rows.map((r) => r.work_data?.revision ?? 0).join(",")} periodId={p.id} rows={rows} canEdit={access.create && p.status === "OPEN"} batchCurrencies={live.map((b) => b.currency)} /> },
        { label: "دسته‌ها", content: batchesTab },
      ]} />
    </div>
  );
}

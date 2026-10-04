import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { reportByKey } from "@/lib/reports/definitions";
import { loadReport, PAGE_LIMIT } from "@/lib/reports/load";
import type { ReportParams } from "@/lib/reports/params";
import { ReportView, type PeriodOption, type PersonOption } from "@/components/reports/ReportView";

export const dynamic = "force-dynamic";

const flat = (sp: Record<string, string | string[] | undefined>): ReportParams => {
  const out: ReportParams = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
};

export default async function PayrollReportPage({
  params, searchParams,
}: { params: Promise<{ report: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { report } = await params;
  const def = reportByKey(report);
  if (!def || def.family !== "payroll") notFound();
  const sp = flat(await searchParams);
  const supabase = await createClient();

  const needsPeriods = def.filters.some((f) => f === "period" || f === "from" || f === "to");
  const needsPeople = def.filters.includes("personnel");
  const [{ data: periods }, { data: people }, data] = await Promise.all([
    needsPeriods
      ? supabase.from("payroll_periods").select("id, jalali_year, jalali_month").order("jalali_year", { ascending: false }).order("jalali_month", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] }),
    needsPeople ? supabase.rpc("payroll_report_personnel_options") : Promise.resolve({ data: [] }),
    loadReport(supabase, def, sp, PAGE_LIMIT),
  ]);

  return (
    <div>
      <Link href="/payroll/reports" className="mb-3 inline-block text-sm text-seal hover:underline">← همهٔ گزارش‌ها</Link>
      <ReportView
        def={def} basePath={`/payroll/reports/${def.key}`} params={sp} data={data}
        periods={(periods ?? []) as PeriodOption[]} people={(people ?? []) as PersonOption[]}
      />
    </div>
  );
}

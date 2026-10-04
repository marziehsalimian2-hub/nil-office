import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { reportByKey } from "@/lib/reports/definitions";
import { loadReport, PAGE_LIMIT } from "@/lib/reports/load";
import type { ReportParams } from "@/lib/reports/params";
import { ReportView } from "@/components/reports/ReportView";

export const dynamic = "force-dynamic";

const flat = (sp: Record<string, string | string[] | undefined>): ReportParams => {
  const out: ReportParams = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
};

/** HR reports: plain RLS reads of personnel / employment_records (the personnel layout already requires HR access). No amounts exist here. */
export default async function HrReportPage({
  params, searchParams,
}: { params: Promise<{ report: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { report } = await params;
  const def = reportByKey(report);
  if (!def || def.family !== "hr") notFound();
  const sp = flat(await searchParams);
  const supabase = await createClient();
  const data = await loadReport(supabase, def, sp, PAGE_LIMIT);
  return (
    <div>
      <Link href="/personnel/reports" className="mb-3 inline-block text-sm text-seal hover:underline">← گزارش‌های منابع انسانی</Link>
      <ReportView def={def} basePath={`/personnel/reports/${def.key}`} params={sp} data={data} periods={[]} people={[]} />
    </div>
  );
}

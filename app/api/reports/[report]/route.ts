import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reportByKey } from "@/lib/reports/definitions";
import { loadReport, EXPORT_LIMIT } from "@/lib/reports/load";
import { csvHeaders, csvRows } from "@/lib/reports/format";
import type { ReportParams } from "@/lib/reports/params";
import { toCsv } from "@/lib/csv";

/**
 * CSV export of ANY registry report, with the CALLER's own session (RLS / gated RPCs are the real gate; there is no service role).
 * Payroll RPCs raise NOT_AUTHORIZED themselves; HR reads are RLS-filtered; and record_report_export re-checks HR/payroll access and
 * writes ONE audit row (report key + row count only — no filters, no names, no amounts). If that audit call fails the file is NOT
 * returned, so an unauthorised caller never receives data. Amounts are written as exact decimal strings.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const def = reportByKey(report);
  if (!def) return NextResponse.json({ error: "گزارش یافت نشد." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const sp: ReportParams = {};
  req.nextUrl.searchParams.forEach((v, k) => { sp[k] = v; });

  const data = await loadReport(supabase, def, sp, EXPORT_LIMIT);
  if (data.error?.includes("NOT_AUTHORIZED")) return NextResponse.json({ error: "دسترسی به این گزارش را ندارید." }, { status: 403 });
  if (data.missing.length > 0) return NextResponse.json({ error: "فیلتر الزامی انتخاب نشده است." }, { status: 400 });
  if (data.error) return NextResponse.json({ error: "تولید گزارش ناموفق بود." }, { status: 500 });

  const audit = await supabase.rpc("record_report_export", { p_report: def.key, p_rows: data.rows.length });
  if (audit.error) return NextResponse.json({ error: "دسترسی به این گزارش را ندارید." }, { status: 403 });

  const body = toCsv(csvHeaders(def.columns), csvRows(def.columns, data.rows));
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${def.key}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

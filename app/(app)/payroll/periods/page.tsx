import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, EmptyState } from "@/components/ui";
import { PAYROLL_BATCH_STATUS_LABEL, PAYROLL_BATCH_STATUS_TONE, CURRENCY_LABEL, PAYROLL_PERIOD_STATUS_LABEL, type Currency } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import type { PayrollPeriod, PayrollBatch } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function PayrollPeriodsPage() {
  const supabase = await createClient();
  const profile = await requireProfile();
  const canCreate = payrollAccess(profile).create;
  const [{ data: periods }, { data: batches }] = await Promise.all([
    supabase.from("payroll_periods").select("*").order("jalali_year", { ascending: false }).order("jalali_month", { ascending: false }),
    supabase.from("payroll_batches").select("id, batch_number, period_id, currency, status").order("batch_number"),
  ]);
  const rows = (periods ?? []) as PayrollPeriod[];
  const byPeriod = new Map<string, Pick<PayrollBatch, "id" | "batch_number" | "period_id" | "currency" | "status">[]>();
  for (const b of (batches ?? []) as Pick<PayrollBatch, "id" | "batch_number" | "period_id" | "currency" | "status">[]) {
    const list = byPeriod.get(b.period_id) ?? [];
    list.push(b);
    byPeriod.set(b.period_id, list);
  }

  const newBtn = canCreate ? <Link href="/payroll/periods/new" className="btn-seal"><Plus className="h-4 w-4" /> دورهٔ جدید</Link> : undefined;

  return (
    <div>
      <PageHeader title="دوره‌های حقوقی" subtitle="کارکرد ماهانه، دسته‌های محاسبه و بررسی" action={newBtn} />
      {rows.length === 0 ? (
        <EmptyState
          title="هنوز دورهٔ حقوقی ثبت نشده است."
          hint="برای هر ماه شمسی یک دوره بسازید، کارکرد را وارد کنید و سپس دستهٔ محاسبه (برای هر واحد پول) بسازید."
          action={canCreate ? <Link href="/payroll/periods/new" className="btn-primary"><Plus className="h-4 w-4" /> دورهٔ جدید</Link> : undefined}
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">دوره</th><th className="px-4 py-3">بازه</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">دسته‌ها</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-3"><Link href={`/payroll/periods/${p.id}`} className="font-medium text-seal hover:underline">{jalaliMonthLabel(p.jalali_year, p.jalali_month)}</Link></td>
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(p.period_start)} — {formatJalali(p.period_end)}</td>
                  <td className="px-4 py-3 text-ink-muted">{PAYROLL_PERIOD_STATUS_LABEL[p.status]}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {(byPeriod.get(p.id) ?? []).map((b) => (
                        <Link key={b.id} href={`/payroll/batches/${b.id}`} className={`badge ${PAYROLL_BATCH_STATUS_TONE[b.status]}`}>
                          <span className="tnum">{b.batch_number}</span> · {CURRENCY_LABEL[b.currency as Currency] ?? b.currency} · {PAYROLL_BATCH_STATUS_LABEL[b.status]}
                        </Link>
                      ))}
                      {(byPeriod.get(p.id) ?? []).length === 0 && <span className="text-xs text-ink-muted">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

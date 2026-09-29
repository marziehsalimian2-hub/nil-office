import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui";
import { CurrencyAmountList } from "@/app/(app)/dashboard/CurrencyAmountList";
import { PeriodFilter } from "@/components/PeriodFilter";
import { resolvePeriod, type PeriodPreset } from "@/lib/service-ledger/period";
import { formatMoney } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";
import type { ServiceLedgerPortfolioCountsRow, ServiceLedgerPortfolioMoneyRow } from "@/lib/types/database";
import type { CurrencyAmount } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

export default async function ServiceLedgerPortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const profile = await requireProfile();
  const canView = profile.role === "ADMIN" || profile.service_ledger_role != null;
  const { period: periodParam, from, to } = await searchParams;
  const period = resolvePeriod(periodParam ?? "this_month", from, to);

  const supabase = await createClient();
  const [{ data: countsData }, { data: moneyData }] = canView
    ? await Promise.all([
        supabase.rpc("get_service_ledger_portfolio_counts", { p_period_start: period.start, p_period_end: period.end }),
        supabase.rpc("get_service_ledger_portfolio_money", { p_period_start: period.start, p_period_end: period.end }),
      ])
    : [{ data: [] }, { data: [] }];

  const counts = (countsData ?? []) as ServiceLedgerPortfolioCountsRow[];
  const money = (moneyData ?? []) as ServiceLedgerPortfolioMoneyRow[];
  const moneyByClient = new Map<string, ServiceLedgerPortfolioMoneyRow[]>();
  for (const m of money) {
    const arr = moneyByClient.get(m.client_service_file_id) ?? [];
    arr.push(m);
    moneyByClient.set(m.client_service_file_id, arr);
  }

  const unbilledMap = new Map<string, number>();
  const reimbursableMap = new Map<string, number>();
  for (const m of money) {
    if (m.unbilled_amount) unbilledMap.set(m.currency_code, (unbilledMap.get(m.currency_code) ?? 0) + Number(m.unbilled_amount));
    if (m.reimbursable_outstanding_amount) reimbursableMap.set(m.currency_code, (reimbursableMap.get(m.currency_code) ?? 0) + Number(m.reimbursable_outstanding_amount));
  }
  const unbilledByCurrency: CurrencyAmount[] = Array.from(unbilledMap, ([currency_code, amount]) => ({ currency_code, amount }));
  const reimbursableByCurrency: CurrencyAmount[] = Array.from(reimbursableMap, ([currency_code, amount]) => ({ currency_code, amount }));

  if (!canView) {
    return (
      <div>
        <PageHeader title="عملکرد خدمات مشتریان" />
        <Card>
          <p className="text-sm text-ink-muted">این بخش نیاز به دسترسی ماژول خدمات مشتری دارد.</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="عملکرد خدمات مشتریان" subtitle={period.label} />
      <div className="mb-4">
        <PeriodFilter current={(periodParam as PeriodPreset) ?? "this_month"} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="مشتریان فعال" value={toFaDigits(counts.length)} />
        <StatCard label="خدمات این بازه" value={toFaDigits(counts.reduce((s, r) => s + Number(r.services_count), 0))} />
        <StatCard label="مجموع ساعات" value={toFaDigits(Math.round(counts.reduce((s, r) => s + Number(r.hours_total), 0)))} />
        <StatCard label="نیازمند صورتحساب" value={toFaDigits(counts.filter((r) => r.requires_billing).length)} tone="warn" />
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="mb-3 text-sm font-medium text-ink">کار صورتحساب‌نشده (به تفکیک واحد پول)</p>
          <CurrencyAmountList amounts={unbilledByCurrency} emptyText="کار صورتحساب‌نشده‌ای وجود ندارد." />
        </Card>
        <Card>
          <p className="mb-3 text-sm font-medium text-ink">هزینهٔ قابل بازپرداخت وصول‌نشده</p>
          <CurrencyAmountList amounts={reimbursableByCurrency} emptyText="هزینهٔ قابل بازپرداخت وصول‌نشده‌ای وجود ندارد." />
        </Card>
      </div>

      {counts.length === 0 ? (
        <EmptyState title="هیچ پروندهٔ خدمات فعالی وجود ندارد." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">مشتری</th>
                <th className="px-4 py-3">تعداد خدمات</th>
                <th className="px-4 py-3">ساعات</th>
                <th className="px-4 py-3">نیازمند صورتحساب</th>
                <th className="px-4 py-3 text-left">صورتحساب‌نشده</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((r) => {
                const rowMoney = moneyByClient.get(r.client_service_file_id) ?? [];
                return (
                  <tr key={r.client_service_file_id} className="table-row">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${r.company_id}`} className="text-sm text-seal hover:underline">
                        {r.company_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-muted tnum">{toFaDigits(r.services_count)}</td>
                    <td className="px-4 py-3 text-ink-muted tnum">{toFaDigits(Math.round(Number(r.hours_total)))}</td>
                    <td className="px-4 py-3">
                      {r.requires_billing ? <span className="badge bg-paper status-waiting">بله</span> : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left">
                      {rowMoney.length === 0 ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        rowMoney.map((m) => (
                          <div key={m.currency_code} className="tnum text-sm">
                            {formatMoney(m.unbilled_amount)} {m.currency_code}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

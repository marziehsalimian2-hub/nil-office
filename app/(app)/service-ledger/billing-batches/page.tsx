import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { BILLING_BATCH_STATUS_LABEL, BILLING_BATCH_STATUS_TONE, type BillingBatchStatus } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: BillingBatchStatus;
  currency: string;
  total_amount: number;
  created_at: string;
  client_service_files: { companies: { legal_name: string } | { legal_name: string }[] | null } | null;
};

export default async function BillingBatchesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("billing_batches")
    .select("id, status, currency, total_amount, created_at, client_service_files(companies(legal_name))")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <PageHeader
        title="دسته‌های صورتحساب"
        subtitle="گردآوری خدمات و هزینه‌های آمادهٔ صورتحساب، پیش از تبدیل به پیش‌فاکتور یا فاکتور"
        action={
          <Link href="/service-ledger/billing-batches/new" className="btn-seal">
            دستهٔ جدید
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="دسته‌ای ثبت نشده است." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">مشتری</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3">تاریخ</th>
                <th className="px-4 py-3 text-left">مبلغ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const company = Array.isArray(b.client_service_files?.companies)
                  ? b.client_service_files?.companies[0]
                  : b.client_service_files?.companies;
                return (
                  <tr key={b.id} className="table-row">
                    <td className="px-4 py-3">
                      <Link href={`/service-ledger/billing-batches/${b.id}`} className="text-sm text-seal hover:underline">
                        {company?.legal_name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge bg-paper ${BILLING_BATCH_STATUS_TONE[b.status]}`}>{BILLING_BATCH_STATUS_LABEL[b.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted tnum">{formatJalali(b.created_at)}</td>
                    <td className="px-4 py-3 text-left tnum">
                      {formatMoney(b.total_amount)} {b.currency}
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

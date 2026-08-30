import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { PostDocButton } from "@/components/PostDocButton";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const { data } = await supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(100);
  const rows = (data ?? []) as Array<{ id: string; payment_date: string; payee: string | null; amount: number; description: string | null; status: PostingStatus }>;
  return (
    <div>
      <PageHeader title="پرداخت‌ها" subtitle="مدیریت اسناد نقدی پرداختی"
        action={<Link href="/accounting/payments/new" className="btn-seal"><Plus className="h-4 w-4" /> پرداخت جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="موردی ثبت نشده است."
          action={<Link href="/accounting/payments/new" className="btn-primary"><Plus className="h-4 w-4" /> پرداخت جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">تاریخ</th><th className="px-4 py-3">پرداخت به</th><th className="px-4 py-3">شرح</th>
              <th className="px-4 py-3 text-left">مبلغ</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-row cursor-default">
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(r.payment_date)}</td>
                  <td className="px-4 py-3 text-ink">{r.payee ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.description ?? "—"}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(r.amount, unit)}</td>
                  <td className="px-4 py-3"><span className={`badge ${POSTING_STATUS_TONE[r.status]}`}>{POSTING_STATUS_LABEL[r.status]}</span></td>
                  <td className="px-4 py-3">{r.status === "DRAFT" && <PostDocButton id={r.id} kind="payment" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { getDisplayUnit, loadAccountingOptions } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { PostedLine } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const { postingAccounts } = await loadAccountingOptions();

  let rows: Pick<PostedLine, "id" | "document_number" | "document_date" | "debit" | "credit">[] = [];
  if (account) {
    const { data } = await supabase
      .from("v_posted_lines")
      .select("id, document_number, document_date, debit, credit")
      .eq("account_id", account)
      .order("document_date");
    rows = (data ?? []) as typeof rows;
  }
  let running = 0;

  return (
    <div>
      <PageHeader title="دفتر کل" subtitle="گردش حساب بر پایهٔ اقلام ثبت‌قطعی" />
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="field-label">انتخاب حساب</label>
            <select name="account" defaultValue={account ?? ""} className="input">
              <option value="" disabled>— یک حساب انتخاب کنید —</option>
              {postingAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
            </select>
          </div>
          <button className="btn-primary">نمایش</button>
        </form>
      </Card>

      {!account ? (
        <EmptyState title="برای مشاهدهٔ گردش، یک حساب انتخاب کنید." />
      ) : rows.length === 0 ? (
        <EmptyState title="برای این حساب سند ثبت‌قطعی‌شده‌ای وجود ندارد." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">تاریخ</th><th className="px-4 py-3">شماره سند</th>
              <th className="px-4 py-3 text-left">بدهکار</th><th className="px-4 py-3 text-left">بستانکار</th><th className="px-4 py-3 text-left">مانده</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                running += Number(r.debit) - Number(r.credit);
                return (
                  <tr key={r.id} className="table-row cursor-default">
                    <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(r.document_date)}</td>
                    <td className="px-4 py-3 tnum text-seal" dir="ltr">{r.document_number ? toFaDigits(r.document_number) : "—"}</td>
                    <td className="px-4 py-3 text-left tnum" dir="ltr">{Number(r.debit) ? formatMoney(r.debit) : "—"}</td>
                    <td className="px-4 py-3 text-left tnum" dir="ltr">{Number(r.credit) ? formatMoney(r.credit) : "—"}</td>
                    <td className="px-4 py-3 text-left tnum font-medium" dir="ltr">{formatMoney(running, unit)}</td>
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

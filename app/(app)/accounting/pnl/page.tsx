import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import type { PostedLine } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function PnlPage() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const { data } = await supabase.from("v_posted_lines").select("account_id, account_code, account_name, account_type, debit, credit");
  const lines = (data ?? []) as Pick<PostedLine, "account_id" | "account_code" | "account_name" | "account_type" | "debit" | "credit">[];

  const agg = (type: string) => {
    const m = new Map<string, { name: string; v: number }>();
    for (const l of lines.filter((x) => x.account_type === type)) {
      const cur = m.get(l.account_id) ?? { name: l.account_name, v: 0 };
      // revenue is credit-natured, expense is debit-natured
      cur.v += type === "REVENUE" ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      m.set(l.account_id, cur);
    }
    return [...m.values()].filter((r) => r.v !== 0);
  };
  const revenue = agg("REVENUE");
  const expense = agg("EXPENSE");
  const totalRev = revenue.reduce((s, r) => s + r.v, 0);
  const totalExp = expense.reduce((s, r) => s + r.v, 0);
  const net = totalRev - totalExp;

  const Section = ({ title, rows, total }: { title: string; rows: { name: string; v: number }[]; total: number }) => (
    <Card>
      <h3 className="mb-3 font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">موردی ثبت نشده است.</p> : (
        <table className="w-full text-sm">
          <tbody>{rows.map((r) => (
            <tr key={r.name} className="border-b border-line/60">
              <td className="py-2 text-ink">{r.name}</td>
              <td className="py-2 text-left tnum" dir="ltr">{formatMoney(r.v)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="font-semibold"><td className="pt-2 text-ink-muted">جمع</td>
            <td className="pt-2 text-left tnum" dir="ltr">{formatMoney(total)}</td></tr></tfoot>
        </table>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader title="صورت سود و زیان" subtitle={`فقط اقلام ثبت‌قطعی — واحد: ${unit === "RIAL" ? "ریال" : "تومان"}`} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="درآمدها" rows={revenue} total={totalRev} />
        <Section title="هزینه‌ها" rows={expense} total={totalExp} />
      </div>
      <Card className="mt-4 flex items-center justify-between">
        <span className="font-semibold text-ink">{net >= 0 ? "سود دوره" : "زیان دوره"}</span>
        <span className={`text-lg font-bold tnum ${net >= 0 ? "text-status-final" : "text-status-cancelled"}`} dir="ltr">{formatMoney(Math.abs(net), unit)}</span>
      </Card>
    </div>
  );
}

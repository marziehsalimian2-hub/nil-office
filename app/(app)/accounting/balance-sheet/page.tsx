import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import type { PostedLine } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const { data } = await supabase.from("v_posted_lines").select("account_id, account_name, account_type, debit, credit");
  const lines = (data ?? []) as Pick<PostedLine, "account_id" | "account_name" | "account_type" | "debit" | "credit">[];

  // Net income folds into equity (Revenue - Expense).
  const sumType = (type: string, creditNatured: boolean) => {
    const m = new Map<string, { name: string; v: number }>();
    for (const l of lines.filter((x) => x.account_type === type)) {
      const cur = m.get(l.account_id) ?? { name: l.account_name, v: 0 };
      cur.v += creditNatured ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      m.set(l.account_id, cur);
    }
    return [...m.values()].filter((r) => r.v !== 0);
  };
  const assets = sumType("ASSET", false);
  const liab = sumType("LIABILITY", true);
  const equity = sumType("EQUITY", true);
  const revenue = sumType("REVENUE", true).reduce((s, r) => s + r.v, 0);
  const expense = sumType("EXPENSE", false).reduce((s, r) => s + r.v, 0);
  const net = revenue - expense;

  const tAssets = assets.reduce((s, r) => s + r.v, 0);
  const tLiab = liab.reduce((s, r) => s + r.v, 0);
  const tEquity = equity.reduce((s, r) => s + r.v, 0) + net;
  const rightSide = tLiab + tEquity;
  const balanced = Math.abs(tAssets - rightSide) < 1e-6;

  const Block = ({ title, rows, extra }: { title: string; rows: { name: string; v: number }[]; extra?: { name: string; v: number } }) => (
    <Card>
      <h3 className="mb-3 font-semibold text-ink">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-line/60"><td className="py-2 text-ink">{r.name}</td>
              <td className="py-2 text-left tnum" dir="ltr">{formatMoney(r.v)}</td></tr>
          ))}
          {extra && (
            <tr className="border-b border-line/60"><td className="py-2 text-ink">{extra.name}</td>
              <td className="py-2 text-left tnum" dir="ltr">{formatMoney(extra.v)}</td></tr>
          )}
          {rows.length === 0 && !extra && <tr><td className="py-2 text-ink-muted">—</td><td></td></tr>}
        </tbody>
      </table>
    </Card>
  );

  return (
    <div>
      <PageHeader title="ترازنامه" subtitle={`بر پایهٔ اقلام ثبت‌قطعی — واحد: ${unit === "RIAL" ? "ریال" : "تومان"}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="دارایی‌ها" rows={assets} />
        <div className="space-y-4">
          <Block title="بدهی‌ها" rows={liab} />
          <Block title="حقوق صاحبان سهام" rows={equity} extra={{ name: net >= 0 ? "سود دورهٔ جاری" : "زیان دورهٔ جاری", v: net }} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card className="flex items-center justify-between"><span className="font-semibold text-ink">جمع دارایی‌ها</span>
          <span className="text-lg font-bold tnum text-ink" dir="ltr">{formatMoney(tAssets, unit)}</span></Card>
        <Card className="flex items-center justify-between"><span className="font-semibold text-ink">جمع بدهی‌ها + حقوق صاحبان سهام</span>
          <span className="text-lg font-bold tnum text-ink" dir="ltr">{formatMoney(rightSide, unit)}</span></Card>
      </div>
      <p className={`mt-3 text-sm ${balanced ? "text-status-final" : "text-status-cancelled"}`}>
        {balanced ? "✓ ترازنامه متوازن است." : "⚠ عدم توازن — احتمالاً اسناد افتتاحیه یا بستنِ حساب‌ها کامل نیست."}
      </p>
    </div>
  );
}

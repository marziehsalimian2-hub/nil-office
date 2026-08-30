import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";
import type { PostedLine } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const { data } = await supabase.from("v_posted_lines").select("account_id, account_code, account_name, debit, credit");
  const lines = (data ?? []) as Pick<PostedLine, "account_id" | "account_code" | "account_name" | "debit" | "credit">[];

  const map = new Map<string, { code: string; name: string; d: number; c: number }>();
  for (const l of lines) {
    const cur = map.get(l.account_id) ?? { code: l.account_code, name: l.account_name, d: 0, c: 0 };
    cur.d += Number(l.debit); cur.c += Number(l.credit);
    map.set(l.account_id, cur);
  }
  const rows = [...map.values()].filter((r) => r.d !== 0 || r.c !== 0).sort((a, b) => a.code.localeCompare(b.code));
  const totalD = rows.reduce((s, r) => s + r.d, 0);
  const totalC = rows.reduce((s, r) => s + r.c, 0);
  const balanced = Math.abs(totalD - totalC) < 1e-6;

  return (
    <div>
      <PageHeader title="تراز آزمایشی" subtitle={`فقط اقلام ثبت‌قطعی — واحد: ${unit === "RIAL" ? "ریال" : "تومان"}`} />
      {rows.length === 0 ? (
        <EmptyState title="هنوز سند ثبت‌قطعی‌شده‌ای وجود ندارد." hint="تراز آزمایشی فقط از اسناد ثبت‌قطعی ساخته می‌شود." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[520px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">کد</th><th className="px-4 py-3">حساب</th>
              <th className="px-4 py-3 text-left">بدهکار</th><th className="px-4 py-3 text-left">بستانکار</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="table-row cursor-default">
                  <td className="px-4 py-3 tnum text-ink-muted" dir="ltr">{toFaDigits(r.code)}</td>
                  <td className="px-4 py-3 text-ink">{r.name}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{r.d ? formatMoney(r.d) : "—"}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{r.c ? formatMoney(r.c) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-line bg-paper/60 font-semibold">
              <td colSpan={2} className="px-4 py-3 text-ink-muted">جمع کل</td>
              <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(totalD)}</td>
              <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(totalC)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className={`mt-3 text-sm ${balanced ? "text-status-final" : "text-status-cancelled"}`}>
          {balanced ? "✓ تراز است؛ جمع بدهکار و بستانکار برابر است." : "⚠ عدم تراز — با پشتیبانی بررسی شود."}
        </p>
      )}
    </div>
  );
}

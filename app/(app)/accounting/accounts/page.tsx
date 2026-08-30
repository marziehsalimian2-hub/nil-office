import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_LEVEL_LABEL, type AccountType } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import type { Account } from "@/lib/types/database";
export const dynamic = "force-dynamic";
export default async function AccountsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("*").order("code");
  const rows = (data ?? []) as Account[];
  return (
    <div>
      <PageHeader title="کدینگ حساب‌ها" subtitle="گروه ← کل ← معین ← تفصیلی"
        action={<Link href="/accounting/accounts/new" className="btn-seal"><Plus className="h-4 w-4" /> حساب جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="کدینگی تعریف نشده است." hint="می‌توانید از دادهٔ اولیهٔ مهاجرت 0010 استفاده کنید یا حساب جدید بسازید."
          action={<Link href="/accounting/accounts/new" className="btn-primary"><Plus className="h-4 w-4" /> حساب جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">کد</th><th className="px-4 py-3">نام</th><th className="px-4 py-3">سطح</th>
              <th className="px-4 py-3">نوع</th><th className="px-4 py-3">قابل‌ثبت</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="table-row">
                  <td className="px-4 py-3 tnum font-medium" dir="ltr" style={{ paddingRight: `${(a.level - 1) * 16 + 16}px` }}>{a.code}</td>
                  <td className="px-4 py-3 text-ink">{a.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{ACCOUNT_LEVEL_LABEL[a.level]}</td>
                  <td className="px-4 py-3 text-ink-muted">{ACCOUNT_TYPE_LABEL[a.account_type as AccountType]}</td>
                  <td className="px-4 py-3">{a.allows_posting ? <span className="text-status-final">✓</span> : <span className="text-ink-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

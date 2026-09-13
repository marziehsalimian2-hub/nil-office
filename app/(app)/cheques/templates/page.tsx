import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { toFaDigits } from "@/lib/jalali";
import type { ChequePrintTemplate } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ChequeTemplatesPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("cheque_print_templates").select("*, bank_accounts(bank_name, account_title)").order("created_at", { ascending: false });
  const rows = (data ?? []) as (ChequePrintTemplate & { bank_accounts: { bank_name: string | null; account_title: string } | null })[];

  return (
    <div>
      <PageHeader
        title="قالب‌های چاپ چک"
        subtitle="تنظیم جای فیلدها روی برگهٔ فیزیکی چک (فقط برای ادمین چک)"
        action={
          <Link href="/cheques/templates/new" className="btn-seal">
            <Plus className="h-4 w-4" /> قالب جدید
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="قالبی ثبت نشده است." action={<Link href="/cheques/templates/new" className="btn-primary"><Plus className="h-4 w-4" /> قالب جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">نام قالب</th>
                <th className="px-4 py-3">حساب بانکی</th>
                <th className="px-4 py-3">ابعاد (mm)</th>
                <th className="px-4 py-3">فعال</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/cheques/templates/${t.id}`} className="font-medium text-seal hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{t.bank_accounts?.bank_name ?? t.bank_accounts?.account_title ?? "همهٔ بانک‌ها"}</td>
                  <td className="px-4 py-3 tnum text-ink-muted" dir="ltr">
                    {toFaDigits(t.page_width_mm)} × {toFaDigits(t.page_height_mm)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{t.is_active ? "بله" : "خیر"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

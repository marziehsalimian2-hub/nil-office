import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import type { ChequeBook } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "فعال", COMPLETED: "تکمیل‌شده", CANCELLED: "لغوشده", ARCHIVED: "بایگانی‌شده" };

export default async function ChequeBooksPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cheque_books")
    .select("*, bank_accounts(bank_name, account_title)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (ChequeBook & { bank_accounts: { bank_name: string | null; account_title: string } | null })[];

  return (
    <div>
      <PageHeader
        title="دسته‌چک‌ها"
        subtitle="مدیریت دسته‌چک‌های بانکی"
        action={
          <Link href="/cheques/books/new" className="btn-seal">
            <Plus className="h-4 w-4" /> دسته‌چک جدید
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="دسته‌چکی ثبت نشده است." action={<Link href="/cheques/books/new" className="btn-primary"><Plus className="h-4 w-4" /> دسته‌چک جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شناسه دسته‌چک</th>
                <th className="px-4 py-3">حساب بانکی</th>
                <th className="px-4 py-3">تعداد برگه</th>
                <th className="px-4 py-3">تاریخ صدور</th>
                <th className="px-4 py-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/cheques/books/${b.id}`} className="font-medium text-seal hover:underline">
                      {b.book_identifier}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{b.bank_accounts?.bank_name ?? b.bank_accounts?.account_title ?? "—"}</td>
                  <td className="px-4 py-3 tnum text-ink">{toFaDigits(b.leaves_count)}</td>
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(b.issue_date)}</td>
                  <td className="px-4 py-3 text-ink-muted">{STATUS_LABEL[b.status] ?? b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { ChequeStatusBadge } from "@/components/ChequeStatusBadge";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { ChequeBookStatusForm } from "./ChequeBookStatusForm";
import type { ChequeBook, Cheque } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ChequeBookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: book }, { data: cheques }] = await Promise.all([
    supabase.from("cheque_books").select("*, bank_accounts(bank_name, branch, account_title, account_number)").eq("id", id).single(),
    supabase.from("cheques").select("id, display_number, cheque_number, counterparty_name_snapshot, amount, currency_code, cheque_date, status").eq("cheque_book_id", id).order("cheque_date"),
  ]);
  if (!book) notFound();
  const b = book as ChequeBook & { bank_accounts: { bank_name: string | null; branch: string | null; account_title: string; account_number: string | null } | null };
  const rows = (cheques ?? []) as Pick<Cheque, "id" | "display_number" | "cheque_number" | "counterparty_name_snapshot" | "amount" | "currency_code" | "cheque_date" | "status">[];

  return (
    <div>
      <PageHeader title={`دسته‌چک ${b.book_identifier}`} subtitle={b.bank_accounts?.bank_name ?? b.bank_accounts?.account_title} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">حساب بانکی</dt>
              <dd className="text-ink">
                {b.bank_accounts?.bank_name} {b.bank_accounts?.branch ? `— شعبه ${b.bank_accounts.branch}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">شمارهٔ حساب</dt>
              <dd className="tnum text-ink" dir="ltr">{b.bank_accounts?.account_number ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">بازهٔ شماره برگه</dt>
              <dd className="tnum text-ink" dir="ltr">{toFaDigits(b.first_cheque_number)} تا {toFaDigits(b.last_cheque_number)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">تعداد برگه</dt>
              <dd className="tnum text-ink">{toFaDigits(b.leaves_count)} (استفاده‌شده: {toFaDigits(rows.length)})</dd>
            </div>
            <div>
              <dt className="text-ink-muted">تاریخ صدور</dt>
              <dd className="tnum text-ink">{formatJalali(b.issue_date)}</dd>
            </div>
            {b.description && (
              <div className="sm:col-span-2">
                <dt className="text-ink-muted">توضیحات</dt>
                <dd className="text-ink">{b.description}</dd>
              </div>
            )}
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">وضعیت دسته‌چک</h2>
          <ChequeBookStatusForm bookId={b.id} currentStatus={b.status} />
        </Card>
      </div>

      <h2 className="mb-3 mt-6 text-sm font-medium text-ink">چک‌های این دسته‌چک</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز چکی از این دسته‌چک ثبت نشده است.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شماره</th>
                <th className="px-4 py-3">ذی‌نفع</th>
                <th className="px-4 py-3">تاریخ</th>
                <th className="px-4 py-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/cheques/${c.id}`} className="tnum font-medium text-seal hover:underline" dir="ltr">
                      {toFaDigits(c.display_number ?? c.cheque_number)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{c.counterparty_name_snapshot}</td>
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(c.cheque_date)}</td>
                  <td className="px-4 py-3">
                    <ChequeStatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { Plus, BookOpen, LayoutTemplate, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { ChequeStatusBadge } from "@/components/ChequeStatusBadge";
import { CHEQUE_DIRECTION_LABEL, CHEQUE_CURRENCY_LABEL } from "@/lib/enums";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import type { Cheque } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ChequesPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; status?: string; q?: string }>;
}) {
  const { direction, status, q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("cheques")
    .select("id, direction, display_number, cheque_number, counterparty_name_snapshot, amount, currency_code, cheque_date, status")
    .order("cheque_date", { ascending: true })
    .limit(200);
  if (direction) query = query.eq("direction", direction);
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`counterparty_name_snapshot.ilike.%${q}%,cheque_number.ilike.%${q}%,display_number.ilike.%${q}%`);

  const { data } = await query;
  const rows = (data ?? []) as Pick<
    Cheque,
    "id" | "direction" | "display_number" | "cheque_number" | "counterparty_name_snapshot" | "amount" | "currency_code" | "cheque_date" | "status"
  >[];

  return (
    <div>
      <PageHeader
        title="چک‌ها"
        subtitle="مدیریت چک‌های دریافتی و پرداختی"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/cheques/dashboard" className="btn-ghost">
              <LayoutDashboard className="h-4 w-4" /> داشبورد
            </Link>
            <Link href="/cheques/books" className="btn-ghost">
              <BookOpen className="h-4 w-4" /> دسته‌چک‌ها
            </Link>
            <Link href="/cheques/templates" className="btn-ghost">
              <LayoutTemplate className="h-4 w-4" /> قالب‌های چاپ
            </Link>
            <Link href="/cheques/new" className="btn-seal">
              <Plus className="h-4 w-4" /> چک جدید
            </Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="جست‌وجوی طرف حساب، شمارهٔ چک..."
          className="input max-w-xs"
        />
        {direction && <input type="hidden" name="direction" value={direction} />}
        {status && <input type="hidden" name="status" value={status} />}
        <button type="submit" className="btn-ghost">
          جست‌وجو
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/cheques" className={cn("btn-ghost", !direction && "border-seal text-seal")}>
          همه
        </Link>
        <Link href="/cheques?direction=PAYABLE" className={cn("btn-ghost", direction === "PAYABLE" && "border-seal text-seal")}>
          پرداختی
        </Link>
        <Link href="/cheques?direction=RECEIVABLE" className={cn("btn-ghost", direction === "RECEIVABLE" && "border-seal text-seal")}>
          دریافتی
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="چکی ثبت نشده است."
          action={
            <Link href="/cheques/new" className="btn-primary">
              <Plus className="h-4 w-4" /> چک جدید
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شماره</th>
                <th className="px-4 py-3">جهت</th>
                <th className="px-4 py-3">طرف حساب</th>
                <th className="px-4 py-3">تاریخ</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3 text-left">مبلغ</th>
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
                  <td className="px-4 py-3 text-ink-muted">{CHEQUE_DIRECTION_LABEL[c.direction]}</td>
                  <td className="px-4 py-3 text-ink">{c.counterparty_name_snapshot}</td>
                  <td className="px-4 py-3 text-ink-muted tnum">{formatJalali(c.cheque_date)}</td>
                  <td className="px-4 py-3">
                    <ChequeStatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-left tnum">
                    {toFaDigits(new Intl.NumberFormat("en-US").format(c.amount))} {CHEQUE_CURRENCY_LABEL[c.currency_code] ?? c.currency_code}
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

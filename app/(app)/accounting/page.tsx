import Link from "next/link";
import { BookOpen, ArrowDownCircle, ArrowUpCircle, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, StatCard } from "@/components/ui";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import type { PostedLine, JournalEntry, BankAccount } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function AccountingDashboard() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();

  const [{ data: lineData }, { data: banksData }, draftRes, { data: recentData }] = await Promise.all([
    supabase.from("v_posted_lines").select("account_id, account_type, debit, credit"),
    supabase.from("bank_accounts").select("account_id").eq("is_active", true),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("status", "DRAFT"),
    supabase.from("journal_entries").select("*").eq("status", "POSTED").order("posted_at", { ascending: false }).limit(6),
  ]);

  const lines = (lineData ?? []) as Pick<PostedLine, "account_id" | "account_type" | "debit" | "credit">[];
  const bankAccountIds = new Set(((banksData ?? []) as Pick<BankAccount, "account_id">[]).map((b) => b.account_id).filter(Boolean));

  const sumBy = (pred: (l: (typeof lines)[number]) => boolean, creditNatured = false) =>
    lines.filter(pred).reduce((s, l) => s + (creditNatured ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit)), 0);

  const cashBank = sumBy((l) => bankAccountIds.has(l.account_id));
  const assets = sumBy((l) => l.account_type === "ASSET");
  const liabilities = sumBy((l) => l.account_type === "LIABILITY", true);
  const revenue = sumBy((l) => l.account_type === "REVENUE", true);
  const expense = sumBy((l) => l.account_type === "EXPENSE");
  const draftCount = draftRes.count ?? 0;
  const recent = (recentData ?? []) as JournalEntry[];

  return (
    <div>
      <PageHeader title="داشبورد مالی" subtitle="نمای کلی وضعیت حسابداری"
        action={<Link href="/accounting/journal/new" className="btn-seal"><Plus className="h-4 w-4" /> سند جدید</Link>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="موجودی نقد و بانک" value={formatMoney(cashBank, unit)} />
        <StatCard label="جمع دارایی‌ها" value={formatMoney(assets, unit)} />
        <StatCard label="جمع بدهی‌ها" value={formatMoney(liabilities, unit)} />
        <StatCard label="سود/زیان (ثبت‌قطعی)" value={formatMoney(revenue - expense, unit)} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/accounting/receipts/new" className="card flex items-center gap-3 p-4 transition hover:border-seal/40">
          <ArrowDownCircle className="h-8 w-8 text-status-final" /><div><p className="font-medium text-ink">ثبت دریافت</p><p className="text-xs text-ink-muted">وجه دریافتی جدید</p></div>
        </Link>
        <Link href="/accounting/payments/new" className="card flex items-center gap-3 p-4 transition hover:border-seal/40">
          <ArrowUpCircle className="h-8 w-8 text-status-cancelled" /><div><p className="font-medium text-ink">ثبت پرداخت</p><p className="text-xs text-ink-muted">وجه پرداختی جدید</p></div>
        </Link>
        <Link href="/accounting/journal" className="card flex items-center gap-3 p-4 transition hover:border-seal/40">
          <BookOpen className="h-8 w-8 text-seal" /><div><p className="font-medium text-ink">اسناد پیش‌نویس</p><p className="text-xs text-ink-muted tnum">{toFaDigits(draftCount)} سند در انتظار ثبت قطعی</p></div>
        </Link>
      </div>

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">آخرین اسناد ثبت‌قطعی</p>
        {recent.length === 0 ? <p className="text-sm text-ink-muted">هنوز سند ثبت‌قطعی‌شده‌ای وجود ندارد.</p> : (
          <ul className="divide-y divide-line/60">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                <Link href={`/accounting/journal/${e.id}`} className="tnum w-32 shrink-0 text-seal hover:underline" dir="ltr">{e.document_number ? toFaDigits(e.document_number) : "—"}</Link>
                <span className="flex-1 text-ink">{e.description ?? "—"}</span>
                <span className="text-xs text-ink-muted tnum">{formatJalali(e.document_date)}</span>
                <span className={`badge ${POSTING_STATUS_TONE[e.status as PostingStatus]}`}>{POSTING_STATUS_LABEL[e.status as PostingStatus]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

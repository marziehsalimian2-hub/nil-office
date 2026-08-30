import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { JournalEntry } from "@/lib/types/database";
export const dynamic = "force-dynamic";
export default async function JournalListPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("journal_entries").select("*").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as JournalEntry[];
  return (
    <div>
      <PageHeader title="اسناد حسابداری" subtitle="دفتر روزنامه"
        action={<Link href="/accounting/journal/new" className="btn-seal"><Plus className="h-4 w-4" /> سند جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="هنوز سندی ثبت نشده است."
          action={<Link href="/accounting/journal/new" className="btn-primary"><Plus className="h-4 w-4" /> سند جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[560px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">تاریخ</th><th className="px-4 py-3">شرح</th><th className="px-4 py-3">وضعیت</th>
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="table-row cursor-default">
                  <td className="px-4 py-3"><Link href={`/accounting/journal/${e.id}`} className="tnum font-medium text-seal hover:underline" dir="ltr">{e.document_number ? toFaDigits(e.document_number) : "پیش‌نویس"}</Link></td>
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(e.document_date)}</td>
                  <td className="px-4 py-3 text-ink">{e.description ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`badge ${POSTING_STATUS_TONE[e.status as PostingStatus]}`}>{POSTING_STATUS_LABEL[e.status as PostingStatus]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

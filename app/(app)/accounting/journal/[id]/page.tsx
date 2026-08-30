import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { JournalActions } from "./JournalActions";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { JournalEntry, JournalEntryLine, Account } from "@/lib/types/database";
export const dynamic = "force-dynamic";

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const { data: entry } = await supabase.from("journal_entries").select("*").eq("id", id).single();
  if (!entry) notFound();
  const e = entry as JournalEntry;
  const { data: lineData } = await supabase.from("journal_entry_lines").select("*").eq("journal_entry_id", id).order("line_no");
  const lines = (lineData ?? []) as JournalEntryLine[];
  const accIds = [...new Set(lines.map((l) => l.account_id))];
  const { data: accData } = await supabase.from("accounts").select("id, code, name").in("id", accIds.length ? accIds : ["00000000-0000-0000-0000-000000000000"]);
  const accMap = new Map((accData as Pick<Account, "id" | "code" | "name">[] ?? []).map((a) => [a.id, a]));
  const totalD = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalC = lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div>
      <PageHeader title={e.document_number ? `سند ${toFaDigits(e.document_number)}` : "سند پیش‌نویس"}
        subtitle={`تاریخ: ${formatJalali(e.document_date)}`}
        action={<span className={`badge ${POSTING_STATUS_TONE[e.status as PostingStatus]}`}>{POSTING_STATUS_LABEL[e.status as PostingStatus]}</span>} />

      {e.reversal_of && (
        <Card className="mb-4 bg-paper/60">
          <p className="text-sm text-ink-muted">این سند، سندِ برگشتِ سند دیگری است.
            {" "}<Link href={`/accounting/journal/${e.reversal_of}`} className="text-seal underline">مشاهدهٔ سند اصلی</Link></p>
        </Card>
      )}
      {e.description && <p className="mb-4 text-sm text-ink">{e.description}</p>}

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead><tr className="table-head">
            <th className="px-4 py-3 text-right">حساب</th><th className="px-4 py-3 text-right">شرح</th>
            <th className="px-4 py-3 text-left">بدهکار</th><th className="px-4 py-3 text-left">بستانکار</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const a = accMap.get(l.account_id);
              return (
                <tr key={l.id} className="table-row">
                  <td className="px-4 py-3 text-ink"><span className="tnum text-ink-muted" dir="ltr">{a?.code}</span> {a?.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{l.description ?? "—"}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{Number(l.debit) > 0 ? formatMoney(l.debit) : "—"}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{Number(l.credit) > 0 ? formatMoney(l.credit) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-line bg-paper/60 font-semibold">
            <td colSpan={2} className="px-4 py-3 text-left text-ink-muted">جمع ({unit === "RIAL" ? "ریال" : "تومان"})</td>
            <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(totalD)}</td>
            <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(totalC)}</td>
          </tr></tfoot>
        </table>
      </div>

      <JournalActions id={e.id} status={e.status} />
    </div>
  );
}

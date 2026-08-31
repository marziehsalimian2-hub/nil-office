import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { JournalActions } from "./JournalActions";
import { EditableJournalCard } from "./EditableJournalCard";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import { getDisplayUnit, loadAccountingOptions } from "@/app/actions/accounting-options";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { JournalEntry, JournalEntryLine } from "@/lib/types/database";
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

  const canEdit = e.status === "DRAFT";
  const opts = await loadAccountingOptions();
  const accIds = [...new Set(lines.map((l) => l.account_id))];
  const editAccounts = canEdit
    ? opts.postingAccounts
    : opts.allAccounts.filter((a) => accIds.includes(a.id));

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

      <div className="mb-4 space-y-4">
        <EditableJournalCard
          id={e.id}
          canEdit={canEdit}
          accounts={editAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          details={opts.details.map((d) => ({ id: d.id, label: d.name }))}
          companies={opts.companies.map((c) => ({ id: c.id, label: c.legal_name }))}
          cases={opts.cases.map((c) => ({ id: c.id, label: `${c.case_code} — ${c.title}` }))}
          fiscalYears={opts.fiscalYears.map((f) => ({ id: f.id, label: f.title }))}
          unit={unit}
          header={{ fiscal_year_id: e.fiscal_year_id, document_date: e.document_date, reference: e.reference }}
          description={e.description}
          initialLines={lines.map((l) => ({
            account_id: l.account_id,
            detail_account_id: l.detail_account_id,
            description: l.description,
            debit: Number(l.debit),
            credit: Number(l.credit),
            company_id: l.company_id,
            case_id: l.case_id,
          }))}
        />
      </div>

      <JournalActions id={e.id} status={e.status} />
    </div>
  );
}

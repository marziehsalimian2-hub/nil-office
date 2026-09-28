import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { BatchItemsCard } from "./BatchItemsCard";
import { BatchCandidatesCard, type Candidate } from "./BatchCandidatesCard";
import { BatchActions } from "./BatchActions";
import { BILLING_BATCH_STATUS_LABEL, BILLING_BATCH_STATUS_TONE } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import type { BillingBatch, BillingBatchItem } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function BillingBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: batchRow } = await supabase.from("billing_batches").select("*").eq("id", id).single();
  if (!batchRow) notFound();
  const batch = batchRow as BillingBatch;

  const [{ data: file }, { data: itemsData }] = await Promise.all([
    supabase.from("client_service_files").select("id, company_id, companies(legal_name)").eq("id", batch.client_service_file_id).single(),
    supabase.from("billing_batch_items").select("*").eq("batch_id", id).order("line_no"),
  ]);
  const items = (itemsData ?? []) as BillingBatchItem[];
  const companyRow = file as unknown as { companies: { legal_name: string } | { legal_name: string }[] | null } | null;
  const companyName = (Array.isArray(companyRow?.companies) ? companyRow?.companies[0] : companyRow?.companies)?.legal_name ?? "—";

  let candidates: Candidate[] = [];
  if (batch.status === "DRAFT") {
    const [{ data: readyEntries }, { data: readyExpenses }] = await Promise.all([
      supabase
        .from("service_entries")
        .select("id, title, service_fee, time_entries(duration_minutes, hourly_rate_snapshot, billable)")
        .eq("client_service_file_id", batch.client_service_file_id)
        .eq("billing_status", "READY_TO_BILL"),
      supabase
        .from("expenses")
        .select("id, description, amount, reimbursable_amount, service_entries!inner(client_service_file_id)")
        .eq("billing_status", "READY_TO_BILL")
        .eq("service_entries.client_service_file_id", batch.client_service_file_id),
    ]);

    type EntryRow = { id: string; title: string; service_fee: number; time_entries: { duration_minutes: number; hourly_rate_snapshot: number | null; billable: boolean }[] };
    for (const e of (readyEntries ?? []) as EntryRow[]) {
      if (Number(e.service_fee) > 0) {
        candidates.push({ source_type: "SERVICE_ENTRY", source_id: e.id, description: `حق‌الزحمه: ${e.title}`, amount: Number(e.service_fee) });
      }
      const timeAmount = (e.time_entries ?? []).reduce(
        (sum, t) => (t.billable && t.hourly_rate_snapshot != null ? sum + (t.duration_minutes / 60) * t.hourly_rate_snapshot : sum),
        0,
      );
      if (timeAmount > 0) {
        candidates.push({ source_type: "TIME_ENTRY", source_id: e.id, description: `زمان صرف‌شده: ${e.title}`, amount: timeAmount });
      }
    }

    type ExpenseRow = { id: string; description: string; amount: number; reimbursable_amount: number | null };
    for (const x of (readyExpenses ?? []) as ExpenseRow[]) {
      candidates.push({ source_type: "EXPENSE", source_id: x.id, description: x.description, amount: x.reimbursable_amount ?? x.amount });
    }
  }

  return (
    <div>
      <PageHeader
        title={companyName}
        subtitle={`دستهٔ صورتحساب — ${toFaDigits(items.length)} ردیف`}
        action={<span className={`badge bg-paper ${BILLING_BATCH_STATUS_TONE[batch.status]}`}>{BILLING_BATCH_STATUS_LABEL[batch.status]}</span>}
      />
      <div className="space-y-6">
        <Card>
          <BatchActions batchId={batch.id} status={batch.status} />
          {batch.sales_document_id && (
            <p className="mt-3 text-sm text-ink-muted">
              سند فروش:{" "}
              <Link href={`/invoices/${batch.sales_document_id}`} className="text-seal hover:underline">
                مشاهده
              </Link>
            </p>
          )}
        </Card>
        <BatchItemsCard batchId={batch.id} currency={batch.currency} items={items} editable={batch.status === "DRAFT"} />
        {batch.status === "DRAFT" && <BatchCandidatesCard batchId={batch.id} candidates={candidates} />}
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import {
  CASE_STATUS_LABEL, DIRECTION_LABEL, DOCUMENT_TYPE_LABEL, FOLLOWUP_STATUS_LABEL,
  type CaseStatus, type CorrStatus, type DocumentType, type FollowupStatus,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { Case, Correspondence, DocumentRow, Followup, Company } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: c } = await supabase.from("cases").select("*").eq("id", id).single();
  if (!c) notFound();
  const kase = c as Case;

  const [{ data: corr }, { data: docs }, { data: fups }, { data: companies }] = await Promise.all([
    supabase.from("correspondence").select("*").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.from("documents").select("*").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.from("followups").select("*").eq("case_id", id).order("due_date"),
    supabase.from("companies").select("id, legal_name"),
  ]);

  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((x) => [x.id, x.legal_name]));
  const letters = (corr ?? []) as Correspondence[];
  const documents = (docs ?? []) as DocumentRow[];
  const followups = (fups ?? []) as Followup[];

  return (
    <div>
      <PageHeader title={`${toFaDigits(kase.case_code ?? "")} — ${kase.title}`}
        subtitle={kase.case_type || "پروندهٔ کاری"}
        action={<span className="badge bg-paper text-ink-muted">{CASE_STATUS_LABEL[kase.status as CaseStatus]}</span>} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">مکاتبات پرونده</p>
            {letters.length === 0 ? <p className="text-sm text-ink-muted">مکاتبه‌ای ثبت نشده است.</p> : (
              <ul className="divide-y divide-paper-line/60">
                {letters.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="tnum w-28 shrink-0 text-ink-muted">{l.display_number ? toFaDigits(l.display_number) : "پیش‌نویس"}</span>
                    <Link href={`/correspondence/${l.id}`} className="flex-1 text-ink hover:text-seal">{l.subject || "(بدون موضوع)"}</Link>
                    <span className="text-xs text-ink-muted">{DIRECTION_LABEL[l.direction]}</span>
                    <StatusBadge status={l.status as CorrStatus} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اسناد پرونده</p>
            {documents.length === 0 ? <p className="text-sm text-ink-muted">سندی ثبت نشده است.</p> : (
              <ul className="divide-y divide-paper-line/60">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                    <Link href={`/documents/${d.id}`} className="flex-1 text-ink hover:text-seal">{d.title}</Link>
                    <span className="text-xs text-ink-muted">{DOCUMENT_TYPE_LABEL[d.document_type as DocumentType]}</span>
                    <span className="text-xs text-ink-muted tnum">{formatJalali(d.document_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">پیگیری‌های پرونده</p>
            {followups.length === 0 ? <p className="text-sm text-ink-muted">پیگیری‌ای ثبت نشده است.</p> : (
              <ul className="divide-y divide-paper-line/60">
                {followups.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1 text-ink">{f.title}</span>
                    <span className="text-xs text-ink-muted tnum">{formatJalali(f.due_date)}</span>
                    <span className="text-xs text-ink-muted">{FOLLOWUP_STATUS_LABEL[f.status as FollowupStatus]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-muted">شرکت مرتبط</span><span className="text-ink">{(kase.company_id && companyName.get(kase.company_id)) || "—"}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">تاریخ شروع</span><span className="text-ink tnum">{formatJalali(kase.start_date)}</span></div>
            </div>
            {kase.description && <p className="mt-3 whitespace-pre-wrap border-t border-paper-line/60 pt-3 text-sm text-ink-muted">{kase.description}</p>}
            {kase.tags?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {kase.tags.map((t) => (<span key={t} className="badge bg-seal-tint text-ink-muted">{t}</span>))}
              </div>
            ) : null}
          </Card>
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">پیوست‌های پرونده</p>
            <AttachmentUploader entityType="CASE" entityId={id} />
          </Card>
        </div>
      </div>
    </div>
  );
}

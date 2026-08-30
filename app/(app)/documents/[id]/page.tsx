import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Trash2, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { DOCUMENT_TYPE_LABEL, type DocumentType } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import { formatBytes } from "@/lib/utils";
import type { DocumentRow, Attachment, Company, Case } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-36 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("*").eq("id", id).single();
  if (!doc) notFound();
  const d = doc as DocumentRow;

  const [{ data: companies }, { data: cases }, { data: attachments }] = await Promise.all([
    supabase.from("companies").select("id, legal_name"),
    supabase.from("cases").select("id, case_code, title"),
    supabase.from("attachments").select("*").eq("entity_type", "DOCUMENT").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);
  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]));
  const caseById = new Map(((cases ?? []) as Pick<Case, "id" | "case_code" | "title">[]).map((c) => [c.id, c]));

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(atts.map(async (a) => {
    const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
    if (data?.signedUrl) signed.set(a.id, data.signedUrl);
  }));
  const relatedCase = d.case_id ? caseById.get(d.case_id) : null;

  return (
    <div>
      <PageHeader title={d.title} subtitle={DOCUMENT_TYPE_LABEL[d.document_type as DocumentType]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <Row label="نوع سند">{DOCUMENT_TYPE_LABEL[d.document_type as DocumentType]}</Row>
            <Row label="نسخه">{d.version || "—"}</Row>
            <Row label="شرکت مرتبط">{(d.company_id && companyName.get(d.company_id)) || "—"}</Row>
            <Row label="پرونده">
              {relatedCase ? <Link href={`/cases/${relatedCase.id}`} className="text-seal hover:underline">{relatedCase.case_code} — {relatedCase.title}</Link> : "—"}
            </Row>
            <Row label="تاریخ سند">{formatJalali(d.document_date)}</Row>
            <Row label="تاریخ دریافت">{formatJalali(d.received_date)}</Row>
            {d.description && <Row label="توضیحات">{d.description}</Row>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><Paperclip className="h-4 w-4" /> فایل‌ها</p>
            {atts.length === 0 ? <p className="mb-4 text-sm text-ink-muted">فایلی بارگذاری نشده است.</p> : (
              <ul className="mb-4 divide-y divide-paper-line/60">
                {atts.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 text-sm text-ink">{a.file_name}</span>
                    <span className="text-xs text-ink-muted tnum">{formatBytes(a.size_bytes)}</span>
                    {signed.get(a.id) && <a href={signed.get(a.id)} target="_blank" rel="noopener" className="btn-quiet p-1.5"><Download className="h-4 w-4" /></a>}
                    <form action={deleteAttachmentForm}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="back_to" value={`/documents/${id}`} />
                      <button className="btn-quiet p-1.5 text-status-cancelled"><Trash2 className="h-4 w-4" /></button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AttachmentUploader entityType="DOCUMENT" entityId={id} />
          </Card>
        </div>
      </div>
    </div>
  );
}

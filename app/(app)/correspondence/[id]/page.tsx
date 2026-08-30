import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Trash2, LinkIcon, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, StatusBadge } from "@/components/ui";
import { DetailActions } from "./DetailActions";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import {
  DIRECTION_LABEL,
  PRIORITY_LABEL,
  LANGUAGE_LABEL,
  LINK_RELATION_LABEL,
  type CorrStatus,
  type Priority,
  type Language,
  type LinkRelation,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatBytes } from "@/lib/utils";
import type { Correspondence, Attachment, CorrespondenceLink, Company, Case } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export default async function CorrespondenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: letter } = await supabase.from("correspondence").select("*").eq("id", id).single();
  if (!letter) notFound();
  const l = letter as Correspondence;

  const [{ data: companies }, { data: cases }, { data: links }, { data: attachments }] =
    await Promise.all([
      supabase.from("companies").select("id, legal_name"),
      supabase.from("cases").select("id, case_code, title"),
      supabase
        .from("correspondence_links")
        .select("*")
        .or(`from_correspondence_id.eq.${id},to_correspondence_id.eq.${id}`),
      supabase
        .from("attachments")
        .select("*")
        .eq("entity_type", "CORRESPONDENCE")
        .eq("entity_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const companyName = new Map(
    ((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]),
  );
  const caseById = new Map(
    ((cases ?? []) as Pick<Case, "id" | "case_code" | "title">[]).map((c) => [c.id, c]),
  );

  // Resolve linked letters (the "other" side of each link).
  const linkRows = (links ?? []) as CorrespondenceLink[];
  const otherIds = Array.from(
    new Set(
      linkRows.map((lk) => (lk.from_correspondence_id === id ? lk.to_correspondence_id : lk.from_correspondence_id)),
    ),
  );
  const linkedLetters = new Map<string, Pick<Correspondence, "id" | "display_number" | "subject" | "direction" | "status">>();
  if (otherIds.length) {
    const { data: others } = await supabase
      .from("correspondence")
      .select("id, display_number, subject, direction, status")
      .in("id", otherIds);
    for (const o of (others ?? []) as Correspondence[]) linkedLetters.set(o.id, o);
  }

  // Signed URLs for private attachments.
  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  const relatedCase = l.case_id ? caseById.get(l.case_id) : null;
  const counterparty =
    l.direction === "OUTGOING"
      ? (l.recipient_company_id && companyName.get(l.recipient_company_id)) || l.recipient_name
      : (l.sender_company_id && companyName.get(l.sender_company_id)) || l.recipient_name;

  return (
    <div>
      <PageHeader
        title={l.display_number ? toFaDigits(l.display_number) : "پیش‌نویس نامه"}
        subtitle={`${DIRECTION_LABEL[l.direction]} — ${l.subject || "(بدون موضوع)"}`}
        action={<StatusBadge status={l.status as CorrStatus} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <Row label="موضوع">{l.subject || "—"}</Row>
            <Row label={l.direction === "OUTGOING" ? "گیرنده" : "فرستنده"}>{counterparty || "—"}</Row>
            <Row label="اولویت">{PRIORITY_LABEL[l.priority as Priority]}</Row>
            <Row label="زبان">{LANGUAGE_LABEL[l.language as Language]}</Row>
            <Row label="پرونده">
              {relatedCase ? (
                <Link href={`/cases/${relatedCase.id}`} className="text-seal hover:underline">
                  {relatedCase.case_code} — {relatedCase.title}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            {l.direction === "INCOMING" && (
              <>
                <Row label="شمارهٔ نامهٔ فرستنده">{l.external_letter_number || "—"}</Row>
                <Row label="تاریخ نامهٔ فرستنده">{formatJalali(l.external_letter_date)}</Row>
              </>
            )}
            <Row label="نیاز به پاسخ">{l.requires_response ? "بله" : "خیر"}</Row>
            <Row label="تاریخ پیگیری">{formatJalali(l.followup_date)}</Row>
            <Row label="روش ارسال/دریافت">{l.sent_received_method || "—"}</Row>
            <Row label="تاریخ ثبت">{formatJalali(l.created_at)}</Row>
            {l.finalized_at && <Row label="تاریخ ثبت نهایی">{formatJalali(l.finalized_at)}</Row>}
          </Card>

          {l.draft_text && (
            <Card>
              <p className="mb-2 text-sm font-medium text-ink">متن نامه</p>
              <p className="whitespace-pre-wrap text-sm leading-7 text-ink">{l.draft_text}</p>
            </Card>
          )}

          {l.internal_notes && (
            <Card className="bg-seal-tint/40">
              <p className="mb-1 text-sm font-medium text-ink">یادداشت داخلی</p>
              <p className="whitespace-pre-wrap text-sm text-ink-muted">{l.internal_notes}</p>
            </Card>
          )}

          <Card>
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
              <Paperclip className="h-4 w-4" /> پیوست‌ها
            </p>
            {atts.length === 0 ? (
              <p className="mb-4 text-sm text-ink-muted">پیوستی ثبت نشده است.</p>
            ) : (
              <ul className="mb-4 divide-y divide-paper-line/60">
                {atts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <span className="flex-1 text-sm text-ink">{a.file_name}</span>
                    <span className="text-xs text-ink-muted tnum">{formatBytes(a.size_bytes)}</span>
                    {signed.get(a.id) && (
                      <a href={signed.get(a.id)} target="_blank" rel="noopener" className="btn-quiet p-1.5" aria-label="دانلود">
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    <form action={deleteAttachmentForm}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="back_to" value={`/correspondence/${id}`} />
                      <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AttachmentUploader entityType="CORRESPONDENCE" entityId={id} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <DetailActions
              id={l.id}
              direction={l.direction}
              status={l.status}
              hasNumber={l.sequence_number != null}
            />
          </Card>

          <Card>
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
              <LinkIcon className="h-4 w-4" /> نامه‌های مرتبط
            </p>
            {linkRows.length === 0 ? (
              <p className="text-sm text-ink-muted">نامهٔ مرتبطی وجود ندارد.</p>
            ) : (
              <ul className="space-y-2">
                {linkRows.map((lk) => {
                  const otherId = lk.from_correspondence_id === id ? lk.to_correspondence_id : lk.from_correspondence_id;
                  const o = linkedLetters.get(otherId);
                  if (!o) return null;
                  return (
                    <li key={lk.id} className="text-sm">
                      <span className="text-xs text-ink-muted">{LINK_RELATION_LABEL[lk.relation_type as LinkRelation]}: </span>
                      <Link href={`/correspondence/${o.id}`} className="text-seal hover:underline">
                        {o.display_number ? toFaDigits(o.display_number) : "پیش‌نویس"} — {o.subject || "(بدون موضوع)"}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

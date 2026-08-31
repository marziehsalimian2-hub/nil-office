import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Trash2, LinkIcon, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, StatusBadge } from "@/components/ui";
import { DetailActions } from "./DetailActions";
import { EditableLetterCard } from "./EditableLetterCard";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import {
  DIRECTION_LABEL,
  LINK_RELATION_LABEL,
  type CorrStatus,
  type Priority,
  type Language,
  type LinkRelation,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatBytes } from "@/lib/utils";
import { sanitizeLetterHtml } from "@/lib/sanitize-html";
import type { Correspondence, Attachment, CorrespondenceLink, Company, Case, Profile } from "@/lib/types/database";

export const dynamic = "force-dynamic";

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

  const canEditLetter = l.direction === "OUTGOING" && (l.status === "DRAFT" || l.status === "REVIEW");
  const { data: profiles } = canEditLetter
    ? await supabase.from("profiles").select("id, full_name").eq("is_active", true)
    : { data: null };

  const draftHtml = l.draft_text ? sanitizeLetterHtml(l.draft_text) : null;

  return (
    <div>
      <PageHeader
        title={l.display_number ? toFaDigits(l.display_number) : "پیش‌نویس نامه"}
        subtitle={`${DIRECTION_LABEL[l.direction]} — ${l.subject || "(بدون موضوع)"}`}
        action={<StatusBadge status={l.status as CorrStatus} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EditableLetterCard
            id={id}
            direction={l.direction}
            canEdit={canEditLetter}
            companies={((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => ({ id: c.id, label: c.legal_name }))}
            cases={((cases ?? []) as Pick<Case, "id" | "case_code" | "title">[]).map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
            profiles={((profiles ?? []) as Pick<Profile, "id" | "full_name">[]).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
            view={{
              subject: l.subject,
              counterparty: counterparty ?? null,
              priority: l.priority as Priority,
              language: l.language as Language,
              relatedCase: relatedCase ? { id: relatedCase.id, label: `${relatedCase.case_code} — ${relatedCase.title}` } : null,
              requiresResponse: l.requires_response,
              followupDate: l.followup_date,
              sentReceivedMethod: l.sent_received_method,
              createdAt: l.created_at,
              finalizedAt: l.finalized_at,
              externalLetterNumber: l.external_letter_number,
              externalLetterDate: l.external_letter_date,
              draftHtml,
              internalNotes: l.internal_notes,
            }}
            initial={{
              recipient_company_id: l.recipient_company_id,
              recipient_name: l.recipient_name,
              case_id: l.case_id,
              signatory_id: l.signatory_id,
              signatory_label: l.signatory_label,
              draft_text: draftHtml,
            }}
          />

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

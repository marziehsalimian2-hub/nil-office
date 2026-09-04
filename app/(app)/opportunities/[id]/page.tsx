import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, Trash2, Paperclip, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import { OpportunityStageBadge } from "@/components/OpportunityStageBadge";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { DetailActions } from "./DetailActions";
import { ActivitiesTab } from "../../companies/[id]/ActivitiesTab";
import {
  CRM_OPPORTUNITY_TYPE_LABEL, CRM_OPPORTUNITY_PRIORITY_LABEL, CRM_LOST_REASON_LABEL,
  type CrmOpportunityType, type CrmOpportunityPriority, type CrmLostReason,
  CORR_STATUS_LABEL, CORR_STATUS_TONE, type CorrStatus,
  SALES_DOCUMENT_STATUS_LABEL, SALES_DOCUMENT_STATUS_TONE, type SalesDocumentStatus,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { formatBytes } from "@/lib/utils";
import type {
  CrmOpportunity, CrmOpportunityStageHistory, CrmActivity, Attachment,
  Correspondence, SalesDocument, Followup, CompanyContact,
} from "@/lib/types/database";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const hasInvoiceAccess = profile.role === "ADMIN" || profile.invoice_role != null;

  const { data: opp } = await supabase.from("crm_opportunities").select("*").eq("id", id).single();
  if (!opp) notFound();
  const o = opp as CrmOpportunity;

  const [
    { data: stages },
    { data: company },
    { data: contact },
    { data: owner },
    { data: activities },
    { data: correspondence },
    { data: salesDocs },
    { data: followups },
    { data: attachments },
    { data: stageHistory },
    { data: contracts },
    { data: linkedContract },
  ] = await Promise.all([
    supabase.from("crm_pipeline_stages").select("id, name, is_won, is_lost").eq("pipeline_id", o.pipeline_id).order("sort_order"),
    supabase.from("companies").select("id, legal_name").eq("id", o.company_id).single(),
    o.primary_contact_id ? supabase.from("company_contacts").select("id, first_name, last_name").eq("id", o.primary_contact_id).single() : Promise.resolve({ data: null }),
    o.owner_user_id ? supabase.from("profiles").select("id, full_name").eq("id", o.owner_user_id).single() : Promise.resolve({ data: null }),
    supabase.from("crm_activities").select("*").eq("opportunity_id", id).order("activity_date", { ascending: false }),
    supabase.from("correspondence").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }),
    supabase.from("sales_documents").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }),
    supabase.from("followups").select("*").eq("opportunity_id", id).order("due_date"),
    supabase.from("attachments").select("*").eq("entity_type", "OPPORTUNITY").eq("entity_id", id).order("created_at", { ascending: false }),
    supabase
      .from("crm_opportunity_stage_history")
      .select("id, changed_at, note, from:crm_pipeline_stages!from_stage_id(name), to:crm_pipeline_stages!to_stage_id(name)")
      .eq("opportunity_id", id)
      .order("changed_at", { ascending: false }),
    supabase.from("contracts").select("id, title, display_number, external_contract_number").is("opportunity_id", null).order("created_at", { ascending: false }).limit(50),
    o.contract_id ? supabase.from("contracts").select("id, title, display_number, external_contract_number").eq("id", o.contract_id).single() : Promise.resolve({ data: null }),
  ]);

  const stageList = (stages ?? []) as { id: string; name: string; is_won: boolean; is_lost: boolean }[];
  const currentStage = stageList.find((s) => s.id === o.stage_id);
  const isClosed = !!o.won_at || !!o.lost_at;

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  type HistoryRow = { id: string; changed_at: string; note: string | null; from: { name: string } | { name: string }[] | null; to: { name: string } | { name: string }[] | null };

  const overviewTab = (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">اطلاعات فرصت</p>
        <Row label="شماره">{toFaDigits(o.opportunity_number)}</Row>
        <Row label="شرکت"><Link href={`/companies/${o.company_id}`} className="text-seal hover:underline">{company?.legal_name ?? "—"}</Link></Row>
        <Row label="فرد رابط">{contact ? `${contact.first_name} ${contact.last_name ?? ""}`.trim() : "—"}</Row>
        <Row label="نوع">{CRM_OPPORTUNITY_TYPE_LABEL[o.opportunity_type as CrmOpportunityType]}</Row>
        <Row label="اولویت">{CRM_OPPORTUNITY_PRIORITY_LABEL[o.priority as CrmOpportunityPriority]}</Row>
        <Row label="مالک">{owner?.full_name ?? "—"}</Row>
        <Row label="ارزش تخمینی">{o.estimated_value != null ? `${formatMoney(o.estimated_value)} ${o.currency_code}` : "—"}</Row>
        {o.probability != null && <Row label="احتمال موفقیت">{toFaDigits(o.probability)}٪</Row>}
        <Row label="تاریخ تخمینی بستن">{formatJalali(o.expected_close_date)}</Row>
        {o.source && <Row label="منبع">{o.source}</Row>}
        <Row label="اقدام بعدی">{o.next_action || "—"}{o.next_action_date ? ` — ${formatJalali(o.next_action_date)}` : ""}</Row>
        {o.won_at && <Row label="تاریخ موفقیت">{formatJalali(o.won_at)}</Row>}
        {o.lost_at && (
          <>
            <Row label="تاریخ ازدست‌رفتن">{formatJalali(o.lost_at)}</Row>
            <Row label="دلیل">{o.lost_reason ? CRM_LOST_REASON_LABEL[o.lost_reason as CrmLostReason] : "—"}</Row>
          </>
        )}
        {o.description && (
          <div className="border-b border-paper-line/60 py-2.5 last:border-0">
            <p className="mb-1 text-sm text-ink-muted">شرح</p>
            <p className="whitespace-pre-wrap text-sm text-ink">{o.description}</p>
          </div>
        )}
      </Card>
    </div>
  );

  const activitiesTab = (
    <ActivitiesTab
      companyId={o.company_id}
      opportunityId={id}
      activities={(activities ?? []) as CrmActivity[]}
      contacts={contact ? [contact as Pick<CompanyContact, "id" | "first_name" | "last_name">] : []}
    />
  );

  const correspondenceTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">مکاتبات</p>
      {(correspondence ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">مکاتبه‌ای ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((correspondence ?? []) as Correspondence[]).map((co) => (
            <li key={co.id} className="flex items-center justify-between py-2.5">
              <Link href={co.direction === "OUTGOING" ? `/correspondence/outgoing/${co.id}` : `/correspondence/incoming/${co.id}`} className="text-sm text-seal hover:underline">
                {co.subject || "(بدون موضوع)"}
              </Link>
              <span className={`badge bg-paper ${CORR_STATUS_TONE[co.status as CorrStatus]}`}>{CORR_STATUS_LABEL[co.status as CorrStatus]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const contractTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">قرارداد</p>
      {linkedContract ? (
        <Link href={`/contracts/${linkedContract.id}`} className="text-sm text-seal hover:underline">
          {linkedContract.display_number ?? linkedContract.external_contract_number ?? "پیش‌نویس"} — {linkedContract.title}
        </Link>
      ) : (
        <p className="text-sm text-ink-muted">هنوز قراردادی به این فرصت متصل نشده است.</p>
      )}
    </Card>
  );

  const invoicesTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">پیش‌فاکتورها و فاکتورها</p>
      {(salesDocs ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">سندی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((salesDocs ?? []) as SalesDocument[]).map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2.5">
              <Link href={`/invoices/${s.id}`} className="text-sm text-seal hover:underline">
                {s.display_number ? toFaDigits(s.display_number) : "پیش‌نویس"}
              </Link>
              <span className={`badge bg-paper ${SALES_DOCUMENT_STATUS_TONE[s.status as SalesDocumentStatus]}`}>{SALES_DOCUMENT_STATUS_LABEL[s.status as SalesDocumentStatus]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const followupsTab = (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">پیگیری‌ها</p>
        <Link href={`/followups/new?opportunity_id=${id}`} className="btn-quiet gap-1.5 p-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> پیگیری جدید
        </Link>
      </div>
      {(followups ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">پیگیری‌ای ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((followups ?? []) as Followup[]).map((f) => (
            <li key={f.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-ink">{f.title}</span>
              <span className="text-xs text-ink-muted tnum">{formatJalali(f.due_date)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const documentsTab = (
    <Card>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <Paperclip className="h-4 w-4" /> اسناد و فایل‌ها
      </p>
      {atts.length === 0 ? (
        <p className="mb-4 text-sm text-ink-muted">فایلی ثبت نشده است.</p>
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
                <input type="hidden" name="back_to" value={`/opportunities/${id}`} />
                <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AttachmentUploader entityType="OPPORTUNITY" entityId={id} />
    </Card>
  );

  const historyTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">تاریخچهٔ مراحل</p>
      {(stageHistory ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز جابه‌جایی مرحله‌ای ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((stageHistory ?? []) as HistoryRow[]).map((h) => {
            const from = Array.isArray(h.from) ? h.from[0] : h.from;
            const to = Array.isArray(h.to) ? h.to[0] : h.to;
            return (
              <li key={h.id} className="py-2.5 text-sm text-ink">
                {from ? `${from.name} ← ` : ""}{to?.name}
                <span className="mr-2 text-xs text-ink-muted tnum">{formatJalali(h.changed_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={o.title}
        subtitle={toFaDigits(o.opportunity_number)}
        action={
          <div className="flex items-center gap-3">
            {!isClosed && <Link href={`/opportunities/${id}/edit`} className="btn-ghost">ویرایش</Link>}
            {currentStage && <OpportunityStageBadge name={currentStage.name} isWon={currentStage.is_won} isLost={currentStage.is_lost} />}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs
            tabs={[
              { label: "نمای کلی", content: overviewTab },
              { label: "فعالیت‌ها", content: activitiesTab },
              { label: "مکاتبات", content: correspondenceTab },
              { label: "اسناد", content: documentsTab },
              { label: "پیگیری‌ها", content: followupsTab },
              { label: "قرارداد", content: contractTab },
              { label: "فاکتورها", content: invoicesTab },
              { label: "تاریخچه", content: historyTab },
            ]}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <DetailActions
              id={id}
              stages={stageList}
              currentStageId={o.stage_id}
              isClosed={isClosed}
              hasInvoiceAccess={hasInvoiceAccess}
              hasContract={!!o.contract_id}
              otherContracts={(contracts ?? []).map((c) => ({ id: c.id, label: c.display_number ?? c.external_contract_number ?? c.title }))}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, Trash2, Paperclip, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import { CrmStatusBadge } from "@/components/CrmStatusBadge";
import { EditableCompanyBaseCard, EditableCompanyCrmCard } from "./EditableCompanyCard";
import { ContactsTab } from "./ContactsTab";
import { ActivitiesTab } from "./ActivitiesTab";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, type ContractStatus } from "@/lib/enums";
import { SALES_DOCUMENT_STATUS_LABEL, SALES_DOCUMENT_STATUS_TONE, type SalesDocumentStatus } from "@/lib/enums";
import { CORR_STATUS_LABEL, CORR_STATUS_TONE, type CorrStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatBytes } from "@/lib/utils";
import type {
  Company, CompanyContact, CrmCompanyRole, CrmActivity, Attachment,
  Contract, SalesDocument, Correspondence, Case, Followup,
} from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const canEditCrm = profile.role === "ADMIN" || (profile.crm_role != null && profile.crm_role !== "VIEW");

  const { data: company } = await supabase.from("companies").select("*").eq("id", id).single();
  if (!company) notFound();
  const c = company as Company;

  const [
    { data: roles },
    { data: contacts },
    { data: opportunities },
    { data: activities },
    { data: correspondence },
    { data: cases },
    { data: contracts },
    { data: salesDocs },
    { data: followups },
    { data: attachments },
    { data: profiles },
  ] = await Promise.all([
    supabase.from("crm_company_roles").select("*").eq("company_id", id),
    supabase.from("company_contacts").select("*").eq("company_id", id).order("is_primary", { ascending: false }),
    supabase
      .from("crm_opportunities")
      .select("id, opportunity_number, title, estimated_value, currency_code, won_at, lost_at, crm_pipeline_stages(name)")
      .eq("company_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("crm_activities").select("*").eq("company_id", id).order("activity_date", { ascending: false }).limit(50),
    supabase
      .from("correspondence")
      .select("*")
      .or(`sender_company_id.eq.${id},recipient_company_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("cases").select("*").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("contracts").select("*").eq("counterparty_company_id", id).order("created_at", { ascending: false }),
    supabase.from("sales_documents").select("*").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("followups").select("*").eq("company_id", id).order("due_date"),
    supabase.from("attachments").select("*").eq("entity_type", "COMPANY").eq("entity_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  const profileOpts = ((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, label: p.full_name ?? "—" }));
  const profileName = new Map(profileOpts.map((p) => [p.id, p.label]));

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  type OppRow = { id: string; opportunity_number: string; title: string; estimated_value: number | null; currency_code: string; won_at: string | null; lost_at: string | null; crm_pipeline_stages: { name: string } | { name: string }[] | null };
  const oppRows = (opportunities ?? []) as OppRow[];

  const overviewTab = (
    <div className="space-y-6">
      <EditableCompanyBaseCard
        id={id}
        view={{
          legal_name: c.legal_name,
          english_name: c.english_name,
          country: c.country,
          contact_person: c.contact_person,
          email: c.email,
          phone: c.phone,
          address: c.address,
          notes: c.notes,
        }}
      />
      <EditableCompanyCrmCard
        id={id}
        canEdit={canEditCrm}
        profiles={profileOpts}
        view={{
          crm_status: c.crm_status,
          owner_user_id: c.owner_user_id,
          ownerName: c.owner_user_id ? (profileName.get(c.owner_user_id) ?? null) : null,
          roles: ((roles ?? []) as CrmCompanyRole[]).map((r) => r.role),
        }}
      />
    </div>
  );

  const peopleTab = <ContactsTab companyId={id} contacts={(contacts ?? []) as CompanyContact[]} />;

  const opportunitiesTab = (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">فرصت‌های تجاری</p>
        <Link href={`/opportunities/new?company_id=${id}`} className="btn-quiet gap-1.5 p-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> فرصت جدید
        </Link>
      </div>
      {oppRows.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز فرصتی برای این شرکت ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {oppRows.map((o) => {
            const stage = Array.isArray(o.crm_pipeline_stages) ? o.crm_pipeline_stages[0] : o.crm_pipeline_stages;
            return (
              <li key={o.id} className="py-2.5">
                <Link href={`/opportunities/${o.id}`} className="text-sm text-seal hover:underline">
                  {toFaDigits(o.opportunity_number)} — {o.title}
                </Link>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {stage?.name ?? "—"}
                  {o.won_at && " · موفق"}
                  {o.lost_at && " · ازدست‌رفته"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  const activitiesTab = (
    <ActivitiesTab
      companyId={id}
      activities={(activities ?? []) as CrmActivity[]}
      contacts={((contacts ?? []) as CompanyContact[]).map((c2) => ({ id: c2.id, first_name: c2.first_name, last_name: c2.last_name }))}
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

  const casesTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">پرونده‌ها</p>
      {(cases ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">پرونده‌ای ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((cases ?? []) as Case[]).map((ca) => (
            <li key={ca.id} className="py-2.5">
              <Link href={`/cases/${ca.id}`} className="text-sm text-seal hover:underline">
                {ca.case_code ? `${ca.case_code} — ` : ""}{ca.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const contractsTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">قراردادها</p>
      {(contracts ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">قراردادی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((contracts ?? []) as Contract[]).map((k) => (
            <li key={k.id} className="flex items-center justify-between py-2.5">
              <Link href={`/contracts/${k.id}`} className="text-sm text-seal hover:underline">
                {k.display_number ? toFaDigits(k.display_number) : "پیش‌نویس"} — {k.title}
              </Link>
              <span className={`badge bg-paper ${CONTRACT_STATUS_TONE[k.status as ContractStatus]}`}>{CONTRACT_STATUS_LABEL[k.status as ContractStatus]}</span>
            </li>
          ))}
        </ul>
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
        <Link href={`/followups/new?company_id=${id}`} className="btn-quiet gap-1.5 p-1.5 text-xs">
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
                <input type="hidden" name="back_to" value={`/companies/${id}`} />
                <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AttachmentUploader entityType="COMPANY" entityId={id} />
    </Card>
  );

  return (
    <div>
      <PageHeader title={c.legal_name} subtitle={c.english_name ?? undefined} action={<CrmStatusBadge status={c.crm_status} />} />
      <Tabs
        tabs={[
          { label: "نمای کلی", content: overviewTab },
          { label: "افراد", content: peopleTab },
          { label: "فرصت‌های تجاری", content: opportunitiesTab },
          { label: "فعالیت‌ها", content: activitiesTab },
          { label: "مکاتبات", content: correspondenceTab },
          { label: "پرونده‌ها", content: casesTab },
          { label: "قراردادها", content: contractsTab },
          { label: "پیش‌فاکتورها و فاکتورها", content: invoicesTab },
          { label: "اسناد", content: documentsTab },
          { label: "پیگیری‌ها", content: followupsTab },
        ]}
      />
    </div>
  );
}

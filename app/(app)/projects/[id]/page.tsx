import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, Trash2, Paperclip, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { TaskStatusBadge } from "@/components/TaskStatusBadge";
import { Tabs } from "@/components/Tabs";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { DetailActions } from "./DetailActions";
import { PhasesTab } from "./PhasesTab";
import { MilestonesTab } from "./MilestonesTab";
import { TeamTab } from "./TeamTab";
import { DeliverablesTab } from "./DeliverablesTab";
import {
  PROJECT_TYPE_LABEL, type ProjectType, PM_PRIORITY_LABEL, type PmPriority,
  CORR_STATUS_LABEL, CORR_STATUS_TONE, type CorrStatus,
  SALES_DOCUMENT_STATUS_LABEL, SALES_DOCUMENT_STATUS_TONE, type SalesDocumentStatus,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { formatBytes } from "@/lib/utils";
import type {
  Project, ProjectPhase, ProjectMilestone, ProjectDeliverable, Attachment,
  Correspondence, SalesDocument, Followup, Task, Company,
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

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const hasInvoiceAccess = profile.role === "ADMIN" || profile.invoice_role != null;
  const hasApproveAccess = profile.role === "ADMIN" || ["APPROVE", "ADMIN"].includes(profile.project_role ?? "");

  const { data: proj } = await supabase.from("projects").select("*").eq("id", id).single();
  if (!proj) notFound();
  const p = proj as Project;

  const [
    { data: company },
    { data: manager },
    { data: owner },
    { data: linkedContract },
    { data: phases },
    { data: milestones },
    { data: deliverables },
    { data: memberRows },
    { data: profiles },
    { data: tasks },
    { data: correspondence },
    { data: salesDocs },
    { data: followups },
    { data: attachments },
  ] = await Promise.all([
    p.company_id ? supabase.from("companies").select("id, legal_name").eq("id", p.company_id).single() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name").eq("id", p.project_manager_id).single(),
    p.owner_user_id ? supabase.from("profiles").select("id, full_name").eq("id", p.owner_user_id).single() : Promise.resolve({ data: null }),
    p.contract_id ? supabase.from("contracts").select("id, title, display_number, external_contract_number, status, total_amount, currency_code").eq("id", p.contract_id).single() : Promise.resolve({ data: null }),
    supabase.from("project_phases").select("*").eq("project_id", id).order("sequence"),
    supabase.from("project_milestones").select("*").eq("project_id", id).order("due_date"),
    supabase.from("project_deliverables").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("project_members").select("id, user_id, role, profiles(full_name)").eq("project_id", id).order("joined_at"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
    supabase.from("tasks").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("correspondence").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("sales_documents").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("followups").select("*").eq("project_id", id).order("due_date"),
    supabase.from("attachments").select("*").eq("entity_type", "PROJECT").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  type MemberJoinRow = { id: string; user_id: string; role: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null };
  const memberList = ((memberRows ?? []) as MemberJoinRow[]).map((m) => {
    const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.id, user_id: m.user_id, userName: prof?.full_name ?? "—", role: m.role };
  });

  const overviewTab = (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">اطلاعات پروژه</p>
        <Row label="شماره">{p.display_number ? toFaDigits(p.display_number) : "پیش‌نویس"}</Row>
        <Row label="شرکت">{company ? <Link href={`/companies/${company.id}`} className="text-seal hover:underline">{(company as Pick<Company, "legal_name">).legal_name}</Link> : "—"}</Row>
        <Row label="نوع">{PROJECT_TYPE_LABEL[p.project_type as ProjectType]}</Row>
        <Row label="اولویت">{PM_PRIORITY_LABEL[p.priority as PmPriority]}</Row>
        <Row label="مدیر پروژه">{manager?.full_name ?? "—"}</Row>
        <Row label="مالک داخلی">{owner?.full_name ?? "—"}</Row>
        <Row label="پیشرفت">{toFaDigits(p.progress_percent)}٪</Row>
        <Row label="تاریخ شروع برنامه‌ریزی‌شده">{formatJalali(p.planned_start_date)}</Row>
        <Row label="تاریخ پایان برنامه‌ریزی‌شده">{formatJalali(p.planned_end_date)}</Row>
        {p.actual_start_date && <Row label="تاریخ شروع واقعی">{formatJalali(p.actual_start_date)}</Row>}
        {p.actual_end_date && <Row label="تاریخ پایان واقعی">{formatJalali(p.actual_end_date)}</Row>}
        {p.budget_amount != null && <Row label="بودجه">{formatMoney(p.budget_amount)} {p.budget_currency}</Row>}
        {p.description && (
          <div className="py-2.5">
            <p className="mb-1 text-sm text-ink-muted">شرح</p>
            <p className="whitespace-pre-wrap text-sm text-ink">{p.description}</p>
          </div>
        )}
      </Card>
    </div>
  );

  const phasesTab = <PhasesTab projectId={id} phases={(phases ?? []) as ProjectPhase[]} />;

  const milestonesTab = (
    <MilestonesTab
      projectId={id}
      phases={((phases ?? []) as ProjectPhase[]).map((ph) => ({ id: ph.id, label: ph.name }))}
      profiles={(profiles ?? []).map((pr) => ({ id: pr.id, label: pr.full_name ?? "—" }))}
      milestones={(milestones ?? []) as ProjectMilestone[]}
    />
  );

  const tasksTab = (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">کارهای این پروژه</p>
        <div className="flex gap-2">
          <Link href={`/tasks?project_id=${id}`} className="btn-quiet text-xs">مشاهدهٔ همه</Link>
          <Link href={`/tasks/new?project_id=${id}`} className="btn-quiet gap-1.5 p-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> کار جدید
          </Link>
        </div>
      </div>
      {(tasks ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز کاری ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((tasks ?? []) as Task[]).map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2.5">
              <Link href={`/tasks/${t.id}`} className="text-sm text-seal hover:underline">{t.title}</Link>
              <TaskStatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const deliverablesTab = (
    <DeliverablesTab
      projectId={id}
      phases={((phases ?? []) as ProjectPhase[]).map((ph) => ({ id: ph.id, label: ph.name }))}
      profiles={(profiles ?? []).map((pr) => ({ id: pr.id, label: pr.full_name ?? "—" }))}
      deliverables={(deliverables ?? []) as ProjectDeliverable[]}
      hasApproveAccess={hasApproveAccess}
    />
  );

  const teamTab = (
    <TeamTab projectId={id} profiles={(profiles ?? []).map((pr) => ({ id: pr.id, label: pr.full_name ?? "—" }))} members={memberList} />
  );

  const contractTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">قرارداد</p>
      {linkedContract ? (
        <div>
          <Link href={`/contracts/${linkedContract.id}`} className="text-sm text-seal hover:underline">
            {linkedContract.display_number ?? linkedContract.external_contract_number ?? "پیش‌نویس"} — {linkedContract.title}
          </Link>
          <p className="mt-1 text-xs text-ink-muted">{formatMoney(linkedContract.total_amount)} {linkedContract.currency_code}</p>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">قراردادی به این پروژه متصل نشده است.</p>
      )}
    </Card>
  );

  const financialTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">پیش‌فاکتورها و فاکتورها</p>
      {(salesDocs ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">سندی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {((salesDocs ?? []) as SalesDocument[]).map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2.5">
              <Link href={`/invoices/${s.id}`} className="text-sm text-seal hover:underline">{s.display_number ? toFaDigits(s.display_number) : "پیش‌نویس"}</Link>
              <span className={`badge bg-paper ${SALES_DOCUMENT_STATUS_TONE[s.status as SalesDocumentStatus]}`}>{SALES_DOCUMENT_STATUS_LABEL[s.status as SalesDocumentStatus]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
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

  const followupsTab = (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">پیگیری‌ها</p>
        <Link href={`/followups/new?project_id=${id}`} className="btn-quiet gap-1.5 p-1.5 text-xs">
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
                <input type="hidden" name="back_to" value={`/projects/${id}`} />
                <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AttachmentUploader entityType="PROJECT" entityId={id} />
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={p.title}
        subtitle={p.display_number ? toFaDigits(p.display_number) : "پیش‌نویس پروژه"}
        action={
          <div className="flex items-center gap-3">
            {["DRAFT", "PLANNED"].includes(p.status) && <Link href={`/projects/${id}/edit`} className="btn-ghost">ویرایش</Link>}
            <ProjectStatusBadge status={p.status} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs
            tabs={[
              { label: "نمای کلی", content: overviewTab },
              { label: "فازها", content: phasesTab },
              { label: "مایلستون‌ها", content: milestonesTab },
              { label: "کارها", content: tasksTab },
              { label: "تحویل‌دادنی‌ها", content: deliverablesTab },
              { label: "تیم", content: teamTab },
              { label: "قرارداد", content: contractTab },
              { label: "مالی", content: financialTab },
              { label: "مکاتبات", content: correspondenceTab },
              { label: "اسناد", content: documentsTab },
              { label: "پیگیری‌ها", content: followupsTab },
            ]}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <DetailActions id={id} status={p.status} hasInvoiceAccess={hasInvoiceAccess} />
          </Card>
        </div>
      </div>
    </div>
  );
}

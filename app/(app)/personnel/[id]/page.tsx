import { notFound } from "next/navigation";
import { Trash2, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { EditablePersonnelCard } from "./EditablePersonnelCard";
import { SensitiveDetailsCard } from "./SensitiveDetailsCard";
import { EmploymentActions } from "./EmploymentActions";
import {
  PERSONNEL_STATUS_LABEL, PERSONNEL_STATUS_TONE,
  PERSONNEL_EMPLOYMENT_TYPE_LABEL, HR_DOCUMENT_CATEGORY,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatBytes } from "@/lib/utils";
import type { Personnel, EmploymentRecord, PersonnelSensitiveDetails, Attachment } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function PersonnelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const canManage = profile.role === "ADMIN" || (profile.hr_role != null && profile.hr_role !== "VIEW");
  const canViewSensitive = profile.role === "ADMIN" || profile.hr_role === "ADMIN";

  const { data: personnel } = await supabase.from("personnel").select("*").eq("id", id).single();
  if (!personnel) notFound();
  const p = personnel as Personnel;

  const [{ data: records }, { data: sensitive }, { data: attachments }, { data: activity }, { data: managers }] = await Promise.all([
    supabase.from("employment_records").select("*").eq("personnel_id", id).order("start_date", { ascending: false }),
    supabase.from("personnel_sensitive_details").select("*").eq("personnel_id", id).maybeSingle(),
    supabase.from("attachments").select("*").eq("entity_type", "PERSONNEL").eq("entity_id", id).order("created_at", { ascending: false }),
    supabase.from("activity_logs").select("*").eq("entity_type", "personnel").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("personnel").select("id, first_name, last_name, job_title").eq("employment_status", "ACTIVE").neq("id", id).order("first_name"),
  ]);

  const employmentRecords = (records ?? []) as EmploymentRecord[];
  const currentRecord = employmentRecords.find((r) => r.end_date === null) ?? null;
  const managerOpts = (managers ?? []).map((m) => ({ id: m.id, label: `${m.first_name} ${m.last_name} — ${m.job_title}` }));

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  const overviewTab = (
    <div className="space-y-6">
      <EditablePersonnelCard
        id={id}
        view={{
          personnel_number: p.personnel_number,
          first_name: p.first_name,
          last_name: p.last_name,
          job_title: p.job_title,
          department: p.department,
          mobile: p.mobile,
          email: p.email,
          address: p.address,
          work_location: p.work_location,
          notes: p.notes,
          hire_date: p.hire_date,
        }}
      />
      {canViewSensitive && (
        <SensitiveDetailsCard
          personnelId={id}
          view={{
            national_id: (sensitive as PersonnelSensitiveDetails | null)?.national_id ?? null,
            passport_number: (sensitive as PersonnelSensitiveDetails | null)?.passport_number ?? null,
            birth_date: (sensitive as PersonnelSensitiveDetails | null)?.birth_date ?? null,
            emergency_contact: (sensitive as PersonnelSensitiveDetails | null)?.emergency_contact ?? null,
          }}
        />
      )}
    </div>
  );

  const employmentTab = (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">رکورد اشتغال فعلی</p>
        {currentRecord ? (
          <div className="divide-y divide-paper-line/60">
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink-muted">سمت</span><span className="text-ink">{currentRecord.job_title}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink-muted">نوع همکاری</span><span className="text-ink">{PERSONNEL_EMPLOYMENT_TYPE_LABEL[currentRecord.employment_type]}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink-muted">واحد</span><span className="text-ink">{currentRecord.department ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink-muted">تاریخ شروع</span><span className="tnum text-ink">{formatJalali(currentRecord.start_date)}</span>
            </div>
            {currentRecord.standard_monthly_hours != null && (
              <div className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-ink-muted">ساعات کاری استاندارد (ماهانه)</span>
                <span className="tnum text-ink">{toFaDigits(String(currentRecord.standard_monthly_hours))}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">رکورد اشتغال فعالی یافت نشد.</p>
        )}
      </Card>
      {canManage && <EmploymentActions personnelId={id} currentStatus={p.employment_status} managers={managerOpts} />}
    </div>
  );

  const stubTab = (
    <Card><p className="text-sm text-ink-muted">این بخش در فاز بعدی این ماژول ارائه می‌شود.</p></Card>
  );

  const documentsTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">اسناد پرسنلی</p>
      <p className="mb-3 text-xs text-ink-muted">دسته‌های پیشنهادی: {HR_DOCUMENT_CATEGORY.join("، ")}</p>
      {atts.length === 0 ? (
        <p className="mb-4 text-sm text-ink-muted">سندی ثبت نشده است.</p>
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
              {canManage && (
                <form action={deleteAttachmentForm}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="back_to" value={`/personnel/${id}`} />
                  <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && <AttachmentUploader entityType="PERSONNEL" entityId={id} />}
    </Card>
  );

  const historyTab = (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">تاریخچهٔ اشتغال</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="table-head">
                <th className="px-3 py-2">سمت</th>
                <th className="px-3 py-2">نوع همکاری</th>
                <th className="px-3 py-2">واحد</th>
                <th className="px-3 py-2">شروع</th>
                <th className="px-3 py-2">پایان</th>
                <th className="px-3 py-2">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {employmentRecords.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="px-3 py-2 text-ink">{r.job_title}</td>
                  <td className="px-3 py-2 text-ink-muted">{PERSONNEL_EMPLOYMENT_TYPE_LABEL[r.employment_type]}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.department ?? "—"}</td>
                  <td className="px-3 py-2 tnum text-ink-muted">{formatJalali(r.start_date)}</td>
                  <td className="px-3 py-2 tnum text-ink-muted">{r.end_date ? formatJalali(r.end_date) : "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.status === "ACTIVE" ? "فعال" : "پایان‌یافته"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">رویدادهای ثبت‌شده</p>
        {(activity ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">رویدادی ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-paper-line/60">
            {(activity as { id: string; action: string; created_at: string }[]).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">{e.action}</span>
                <span className="tnum text-xs text-ink-muted">{formatJalali(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={`${p.first_name} ${p.last_name}`}
        subtitle={`${p.job_title} — ${toFaDigits(p.personnel_number)}`}
        action={<span className={`badge ${PERSONNEL_STATUS_TONE[p.employment_status]}`}>{PERSONNEL_STATUS_LABEL[p.employment_status]}</span>}
      />
      <Tabs
        tabs={[
          { label: "نمای کلی", content: overviewTab },
          { label: "اشتغال", content: employmentTab },
          { label: "حقوق و مزایا", content: stubTab },
          { label: "حقوق‌ودستمزد", content: stubTab },
          { label: "پرداخت‌ها", content: stubTab },
          { label: "فیش‌های حقوقی", content: stubTab },
          { label: "اسناد", content: documentsTab },
          { label: "تاریخچه", content: historyTab },
        ]}
      />
    </div>
  );
}

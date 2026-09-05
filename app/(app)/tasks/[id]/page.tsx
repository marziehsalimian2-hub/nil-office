import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, Trash2, Paperclip, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { TaskStatusBadge } from "@/components/TaskStatusBadge";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { PM_PRIORITY_LABEL, type PmPriority } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import { formatBytes } from "@/lib/utils";
import type { Task, Attachment } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
  if (!task) notFound();
  const t = task as Task;

  const [{ data: project }, { data: assignee }, { data: creator }, { data: subtasks }, { data: attachments }] = await Promise.all([
    t.project_id ? supabase.from("projects").select("id, title, display_number").eq("id", t.project_id).single() : Promise.resolve({ data: null }),
    t.assigned_to ? supabase.from("profiles").select("full_name").eq("id", t.assigned_to).single() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("full_name").eq("id", t.created_by).single(),
    supabase.from("tasks").select("id, title, status").eq("parent_task_id", id).order("created_at"),
    supabase.from("attachments").select("*").eq("entity_type", "TASK").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={project ? `پروژه: ${project.display_number ?? project.title}` : "بدون پروژه"}
        action={
          <div className="flex items-center gap-3">
            <Link href={`/tasks/${id}/edit`} className="btn-ghost">ویرایش</Link>
            <TaskStatusBadge status={t.status} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اطلاعات کار</p>
            <Row label="مسئول">{assignee?.full_name ?? "—"}</Row>
            <Row label="ایجادکننده">{creator?.full_name ?? "—"}</Row>
            <Row label="اولویت">{PM_PRIORITY_LABEL[t.priority as PmPriority]}</Row>
            <Row label="تاریخ شروع">{formatJalali(t.start_date)}</Row>
            <Row label="مهلت انجام">{formatJalali(t.due_date)}</Row>
            {t.completed_at && <Row label="تاریخ تکمیل">{formatJalali(t.completed_at)}</Row>}
            {t.status === "BLOCKED" && t.blocked_reason && <Row label="دلیل انسداد">{t.blocked_reason}</Row>}
            {(t.estimated_minutes != null || t.actual_minutes != null) && (
              <Row label="زمان (تخمینی / واقعی)">{t.estimated_minutes ?? "—"} / {t.actual_minutes ?? "—"} دقیقه</Row>
            )}
            {t.description && (
              <div className="py-2.5">
                <p className="mb-1 text-sm text-ink-muted">شرح</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{t.description}</p>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">زیرکارها</p>
              <Link href={`/tasks/new?parent_id=${id}${t.project_id ? `&project_id=${t.project_id}` : ""}`} className="btn-quiet gap-1.5 p-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" /> زیرکار جدید
              </Link>
            </div>
            {(subtasks ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">زیرکاری ثبت نشده است.</p>
            ) : (
              <ul className="divide-y divide-paper-line/60">
                {(subtasks ?? []).map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2.5">
                    <Link href={`/tasks/${s.id}`} className="text-sm text-seal hover:underline">{s.title}</Link>
                    <TaskStatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

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
                      <input type="hidden" name="back_to" value={`/tasks/${id}`} />
                      <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AttachmentUploader entityType="TASK" entityId={id} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <Link href={`/followups/new?task_id=${id}${t.project_id ? `&project_id=${t.project_id}` : ""}`} className="btn-ghost w-full justify-center">
              ایجاد پیگیری
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, CheckCircle2, XCircle } from "lucide-react";
import { createDeliverable, updateDeliverable, setDeliverableStatus, acceptDeliverable, rejectDeliverable, deleteDeliverable } from "@/app/actions/project-deliverables";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DELIVERABLE_STATUS_LABEL, DELIVERABLE_STATUS_TONE, type DeliverableStatus } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { ProjectDeliverable } from "@/lib/types/database";

type Opt = { id: string; label: string };

function StatusBadge({ status }: { status: DeliverableStatus }) {
  return (
    <span className={cn("badge bg-paper", DELIVERABLE_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {DELIVERABLE_STATUS_LABEL[status]}
    </span>
  );
}

function DeliverableForm({
  projectId,
  phases,
  profiles,
  deliverable,
  onDone,
}: {
  projectId: string;
  phases: Opt[];
  profiles: Opt[];
  deliverable?: ProjectDeliverable;
  onDone: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = deliverable ? await updateDeliverable(null, fd) : await createDeliverable(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
      <input type="hidden" name="project_id" value={projectId} />
      {deliverable && <input type="hidden" name="id" value={deliverable.id} />}
      <FormError message={error} />
      <Field label="عنوان" required><input name="title" required defaultValue={deliverable?.title ?? ""} className="input" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="فاز مرتبط">
          <select name="phase_id" className="input" defaultValue={deliverable?.phase_id ?? ""}>
            <option value="">—</option>
            {phases.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </Field>
        <Field label="مسئول">
          <select name="responsible_user_id" className="input" defaultValue={deliverable?.responsible_user_id ?? ""}>
            <option value="">—</option>
            {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </Field>
      </div>
      <Field label="مهلت"><JalaliDateInput name="due_date" defaultISO={deliverable?.due_date} /></Field>
      <Field label="شرح"><textarea name="description" rows={2} defaultValue={deliverable?.description ?? ""} className="input" /></Field>
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
        <button type="button" disabled={pending} className="btn-quiet" onClick={onDone}>انصراف</button>
      </div>
    </form>
  );
}

export function DeliverablesTab({
  projectId,
  phases,
  profiles,
  deliverables,
  hasApproveAccess,
}: {
  projectId: string;
  phases: Opt[];
  profiles: Opt[];
  deliverables: ProjectDeliverable[];
  hasApproveAccess: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(fd: FormData, action: (p: null, fd: FormData) => Promise<{ error?: string } | null>) {
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  function advance(id: string, status: string) {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    fd.append("status", status);
    run(fd, setDeliverableStatus);
  }

  function accept(id: string) {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    run(fd, acceptDeliverable);
  }

  function submitReject(id: string) {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    fd.append("reason", rejectReason);
    run(fd, rejectDeliverable);
    setRejectingId(null);
    setRejectReason("");
  }

  function remove(id: string) {
    if (!confirm("حذف این تحویل‌دادنی؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    run(fd, deleteDeliverable);
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">تحویل‌دادنی‌ها</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> تحویل‌دادنی جدید
          </button>
        )}
      </div>
      <FormError message={error} />
      {adding && <div className="mb-4"><DeliverableForm projectId={projectId} phases={phases} profiles={profiles} onDone={() => setAdding(false)} /></div>}
      {deliverables.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز تحویل‌دادنی‌ای ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {deliverables.map((d) =>
            editingId === d.id ? (
              <li key={d.id} className="py-3"><DeliverableForm projectId={projectId} phases={phases} profiles={profiles} deliverable={d} onDone={() => setEditingId(null)} /></li>
            ) : (
              <li key={d.id} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm text-ink">{d.title}</p>
                    <p className="text-xs text-ink-muted">
                      {d.due_date && `مهلت: ${formatJalali(d.due_date)}`}
                      {d.status === "ACCEPTED" && d.accepted_at && ` · پذیرفته‌شده در ${formatJalali(d.accepted_at)}`}
                      {d.status === "REJECTED" && d.rejection_reason && ` · دلیل رد: ${d.rejection_reason}`}
                    </p>
                  </div>
                  <StatusBadge status={d.status} />
                  {d.status !== "ACCEPTED" && (
                    <button type="button" className="btn-quiet p-1.5" aria-label="ویرایش" onClick={() => setEditingId(d.id)}><Pencil className="h-4 w-4" /></button>
                  )}
                  {d.status !== "ACCEPTED" && (
                    <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.status === "PLANNED" && (
                    <button disabled={pending} className="btn-ghost text-xs" onClick={() => advance(d.id, "IN_PROGRESS")}>شروع انجام</button>
                  )}
                  {d.status === "IN_PROGRESS" && (
                    <button disabled={pending} className="btn-ghost text-xs" onClick={() => advance(d.id, "READY_FOR_REVIEW")}>آمادهٔ بررسی</button>
                  )}
                  {d.status === "REJECTED" && (
                    <button disabled={pending} className="btn-ghost text-xs" onClick={() => advance(d.id, "IN_PROGRESS")}>بازگشت به در حال انجام</button>
                  )}
                  {d.status === "READY_FOR_REVIEW" && hasApproveAccess && (
                    <>
                      <button disabled={pending} className="btn-seal text-xs" onClick={() => accept(d.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> پذیرش
                      </button>
                      <button disabled={pending} className="btn-ghost text-xs text-status-cancelled" onClick={() => setRejectingId(d.id)}>
                        <XCircle className="h-3.5 w-3.5" /> رد کردن
                      </button>
                    </>
                  )}
                </div>
                {rejectingId === d.id && (
                  <div className="mt-2 space-y-2 rounded-lg border border-paper-line bg-paper/40 p-3">
                    <Field label="دلیل رد" required>
                      <textarea rows={2} className="input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    </Field>
                    <div className="flex gap-2">
                      <button disabled={pending || !rejectReason.trim()} className="btn-primary text-xs" onClick={() => submitReject(d.id)}>ثبت رد</button>
                      <button className="btn-quiet text-xs" onClick={() => { setRejectingId(null); setRejectReason(""); }}>انصراف</button>
                    </div>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

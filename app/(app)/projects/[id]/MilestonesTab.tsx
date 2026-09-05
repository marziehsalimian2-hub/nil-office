"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { createMilestone, updateMilestone, deleteMilestone } from "@/app/actions/project-milestones";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { Card } from "@/components/ui";
import { PROJECT_MILESTONE_STATUS, PROJECT_MILESTONE_STATUS_LABEL, PM_PRIORITY, PM_PRIORITY_LABEL } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { ProjectMilestone } from "@/lib/types/database";

type Opt = { id: string; label: string };

function MilestoneForm({
  projectId,
  phases,
  profiles,
  milestone,
  onDone,
}: {
  projectId: string;
  phases: Opt[];
  profiles: Opt[];
  milestone?: ProjectMilestone;
  onDone: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = milestone ? await updateMilestone(null, fd) : await createMilestone(null, fd);
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
      {milestone && <input type="hidden" name="id" value={milestone.id} />}
      <FormError message={error} />
      <Field label="عنوان" required><input name="title" required defaultValue={milestone?.title ?? ""} className="input" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="فاز مرتبط">
          <select name="phase_id" className="input" defaultValue={milestone?.phase_id ?? ""}>
            <option value="">—</option>
            {phases.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </Field>
        <Field label="مسئول">
          <select name="responsible_user_id" className="input" defaultValue={milestone?.responsible_user_id ?? ""}>
            <option value="">—</option>
            {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="مهلت"><JalaliDateInput name="due_date" defaultISO={milestone?.due_date} /></Field>
        <Field label="وضعیت">
          <select name="status" className="input" defaultValue={milestone?.status ?? "PLANNED"}>
            {PROJECT_MILESTONE_STATUS.map((s) => (<option key={s} value={s}>{PROJECT_MILESTONE_STATUS_LABEL[s]}</option>))}
          </select>
        </Field>
        <Field label="اولویت">
          <select name="priority" className="input" defaultValue={milestone?.priority ?? "NORMAL"}>
            {PM_PRIORITY.map((p) => (<option key={p} value={p}>{PM_PRIORITY_LABEL[p]}</option>))}
          </select>
        </Field>
      </div>
      <Field label="شرح"><textarea name="description" rows={2} defaultValue={milestone?.description ?? ""} className="input" /></Field>
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
        <button type="button" disabled={pending} className="btn-quiet" onClick={onDone}>انصراف</button>
      </div>
    </form>
  );
}

export function MilestonesTab({
  projectId,
  phases,
  profiles,
  milestones,
}: {
  projectId: string;
  phases: Opt[];
  profiles: Opt[];
  milestones: ProjectMilestone[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  function remove(id: string) {
    if (!confirm("حذف این مایلستون؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    startTransition(async () => {
      await deleteMilestone(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">مایلستون‌ها</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> مایلستون جدید
          </button>
        )}
      </div>
      {adding && <div className="mb-4"><MilestoneForm projectId={projectId} phases={phases} profiles={profiles} onDone={() => setAdding(false)} /></div>}
      {milestones.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز مایلستونی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {milestones.map((m) =>
            editingId === m.id ? (
              <li key={m.id} className="py-3"><MilestoneForm projectId={projectId} phases={phases} profiles={profiles} milestone={m} onDone={() => setEditingId(null)} /></li>
            ) : (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="text-sm text-ink">
                    {m.title}
                    {m.due_date && m.due_date < today && !["COMPLETED", "CANCELLED"].includes(m.status) && (
                      <span className="mr-2 text-xs text-status-cancelled">عقب‌افتاده</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {PROJECT_MILESTONE_STATUS_LABEL[m.status]}
                    {m.due_date && ` · مهلت: ${formatJalali(m.due_date)}`}
                  </p>
                </div>
                <button type="button" className="btn-quiet p-1.5" aria-label="ویرایش" onClick={() => setEditingId(m.id)}><Pencil className="h-4 w-4" /></button>
                <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(m.id)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

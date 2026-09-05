"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { createPhase, updatePhase, deletePhase } from "@/app/actions/project-phases";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { PHASE_STATUS, PHASE_STATUS_LABEL } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { ProjectPhase } from "@/lib/types/database";

function PhaseForm({ projectId, phase, onDone }: { projectId: string; phase?: ProjectPhase; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = phase ? await updatePhase(null, fd) : await createPhase(null, fd);
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
      {phase && <input type="hidden" name="id" value={phase.id} />}
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نام فاز" required><input name="name" required defaultValue={phase?.name ?? ""} className="input" /></Field>
        <Field label="ترتیب"><input name="sequence" type="number" defaultValue={phase?.sequence ?? 0} className="input tnum" dir="ltr" /></Field>
      </div>
      <Field label="وضعیت">
        <select name="status" className="input" defaultValue={phase?.status ?? "NOT_STARTED"}>
          {PHASE_STATUS.map((s) => (<option key={s} value={s}>{PHASE_STATUS_LABEL[s]}</option>))}
        </select>
      </Field>
      <Field label="شرح"><textarea name="description" rows={2} defaultValue={phase?.description ?? ""} className="input" /></Field>
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
        <button type="button" disabled={pending} className="btn-quiet" onClick={onDone}>انصراف</button>
      </div>
    </form>
  );
}

export function PhasesTab({ projectId, phases }: { projectId: string; phases: ProjectPhase[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("حذف این فاز؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    startTransition(async () => {
      await deletePhase(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">فازها</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> فاز جدید
          </button>
        )}
      </div>
      {adding && <div className="mb-4"><PhaseForm projectId={projectId} onDone={() => setAdding(false)} /></div>}
      {phases.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز فازی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {phases.map((p) =>
            editingId === p.id ? (
              <li key={p.id} className="py-3"><PhaseForm projectId={projectId} phase={p} onDone={() => setEditingId(null)} /></li>
            ) : (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="text-sm text-ink">{p.name}</p>
                  <p className="text-xs text-ink-muted">
                    {PHASE_STATUS_LABEL[p.status]}
                    {p.planned_end_date && ` · تا ${formatJalali(p.planned_end_date)}`}
                  </p>
                </div>
                <button type="button" className="btn-quiet p-1.5" aria-label="ویرایش" onClick={() => setEditingId(p.id)}><Pencil className="h-4 w-4" /></button>
                <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createTask, updateTask, type ActionState } from "@/app/actions/tasks";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { TASK_STATUS, TASK_STATUS_LABEL, PM_PRIORITY, PM_PRIORITY_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function TaskForm({
  docId,
  profiles,
  projects,
  parentTasks,
  defaultProjectId,
  defaultParentTaskId,
  initial,
}: {
  docId?: string;
  profiles: Opt[];
  projects: Opt[];
  parentTasks: Opt[];
  defaultProjectId?: string;
  defaultParentTaskId?: string;
  initial?: {
    title: string;
    description: string | null;
    project_id: string | null;
    assigned_to: string | null;
    status: string;
    priority: string;
    start_date: string | null;
    due_date: string | null;
    estimated_minutes: number | null;
    actual_minutes: number | null;
    parent_task_id: string | null;
    blocked_reason: string | null;
  };
}) {
  const action = docId ? updateTask : createTask;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-5">
      {docId && <input type="hidden" name="id" value={docId} />}
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="عنوان کار" required>
          <input name="title" required defaultValue={initial?.title ?? ""} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پروژهٔ مرتبط">
            <select name="project_id" className="input" defaultValue={initial?.project_id ?? defaultProjectId ?? ""}>
              <option value="">— بدون پروژه —</option>
              {projects.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
          <Field label="مسئول">
            <select name="assigned_to" className="input" defaultValue={initial?.assigned_to ?? ""}>
              <option value="">—</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
        </div>

        {parentTasks.length > 0 && (
          <Field label="کار والد (این کار زیرکار آن است)">
            <select name="parent_task_id" className="input" defaultValue={initial?.parent_task_id ?? defaultParentTaskId ?? ""}>
              <option value="">— بدون کار والد —</option>
              {parentTasks.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="وضعیت">
            <select name="status" className="input" defaultValue={initial?.status ?? "TODO"}>
              {TASK_STATUS.map((s) => (<option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>))}
            </select>
          </Field>
          <Field label="اولویت">
            <select name="priority" className="input" defaultValue={initial?.priority ?? "NORMAL"}>
              {PM_PRIORITY.map((p) => (<option key={p} value={p}>{PM_PRIORITY_LABEL[p]}</option>))}
            </select>
          </Field>
        </div>

        <Field label="دلیل مسدود بودن" hint="فقط وقتی وضعیت «مسدود» است نمایش داده می‌شود">
          <input name="blocked_reason" defaultValue={initial?.blocked_reason ?? ""} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ شروع"><JalaliDateInput name="start_date" defaultISO={initial?.start_date} /></Field>
          <Field label="مهلت انجام"><JalaliDateInput name="due_date" defaultISO={initial?.due_date} /></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="زمان تخمینی (دقیقه)">
            <input name="estimated_minutes" type="number" min={0} defaultValue={initial?.estimated_minutes ?? ""} className="input tnum" dir="ltr" />
          </Field>
          <Field label="زمان واقعی (دقیقه)">
            <input name="actual_minutes" type="number" min={0} defaultValue={initial?.actual_minutes ?? ""} className="input tnum" dir="ltr" />
          </Field>
        </div>

        <Field label="شرح"><textarea name="description" rows={3} defaultValue={initial?.description ?? ""} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">{docId ? "ذخیره تغییرات" : "ثبت کار"}</SubmitButton>
        <Link href="/tasks" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

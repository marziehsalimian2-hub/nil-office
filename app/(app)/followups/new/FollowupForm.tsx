"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createFollowup, type ActionState } from "@/app/actions/entities";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
type Opt = { id: string; label: string };
export function FollowupForm({
  cases,
  profiles,
  companyId,
  opportunityId,
  projectId,
  taskId,
}: {
  cases: Opt[];
  profiles: Opt[];
  companyId?: string;
  opportunityId?: string;
  projectId?: string;
  taskId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createFollowup, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      {companyId ? <input type="hidden" name="company_id" value={companyId} /> : null}
      {opportunityId ? <input type="hidden" name="opportunity_id" value={opportunityId} /> : null}
      {projectId ? <input type="hidden" name="project_id" value={projectId} /> : null}
      {taskId ? <input type="hidden" name="task_id" value={taskId} /> : null}
      <div className="card space-y-4 p-5">
        <Field label="عنوان پیگیری" required><input name="title" required className="input" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ سررسید" required><JalaliDateInput name="due_date" required /></Field>
          <Field label="مسئول">
            <select name="assigned_to" className="input" defaultValue="">
              <option value="">— انتخاب —</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
        </div>
        <Field label="پروندهٔ مرتبط">
          <select name="case_id" className="input" defaultValue="">
            <option value="">— بدون پرونده —</option>
            {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </Field>
        <Field label="یادداشت"><textarea name="note" rows={2} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت پیگیری</SubmitButton>
        <Link href="/followups" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

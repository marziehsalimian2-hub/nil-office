"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createProjectDraft, updateProjectDraft, type ActionState } from "@/app/actions/projects";
import { Field, FormError, SubmitButton } from "@/components/form";
import { MoneyInput } from "@/components/MoneyInput";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { PROJECT_TYPE, PROJECT_TYPE_LABEL, PM_PRIORITY, PM_PRIORITY_LABEL, CURRENCY } from "@/lib/enums";

type Opt = { id: string; label: string };

export function ProjectForm({
  docId,
  companies,
  cases,
  opportunities,
  contracts,
  profiles,
  defaultOpportunityId,
  defaultContractId,
  initial,
}: {
  docId?: string;
  companies: Opt[];
  cases: Opt[];
  opportunities: Opt[];
  contracts: Opt[];
  profiles: Opt[];
  defaultOpportunityId?: string;
  defaultContractId?: string;
  initial?: {
    title: string;
    description: string | null;
    project_type: string;
    company_id: string | null;
    case_id: string | null;
    crm_opportunity_id: string | null;
    contract_id: string | null;
    project_manager_id: string;
    owner_user_id: string | null;
    priority: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
    actual_start_date: string | null;
    actual_end_date: string | null;
    progress_percent: number;
    budget_amount: number | null;
    budget_currency: string | null;
  };
}) {
  const action = docId ? updateProjectDraft : createProjectDraft;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-5">
      {docId && <input type="hidden" name="id" value={docId} />}
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="عنوان پروژه" required>
          <input name="title" required defaultValue={initial?.title ?? ""} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع پروژه">
            <select name="project_type" className="input" defaultValue={initial?.project_type ?? "OTHER"}>
              {PROJECT_TYPE.map((t) => (<option key={t} value={t}>{PROJECT_TYPE_LABEL[t]}</option>))}
            </select>
          </Field>
          <Field label="شرکت">
            <select name="company_id" className="input" defaultValue={initial?.company_id ?? ""}>
              <option value="">—</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="فرصت تجاری مرتبط">
            <select name="crm_opportunity_id" className="input" defaultValue={initial?.crm_opportunity_id ?? defaultOpportunityId ?? ""}>
              <option value="">—</option>
              {opportunities.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
            </select>
          </Field>
          <Field label="قرارداد مرتبط">
            <select name="contract_id" className="input" defaultValue={initial?.contract_id ?? defaultContractId ?? ""}>
              <option value="">—</option>
              {contracts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>

        <Field label="پروندهٔ مرتبط">
          <select name="case_id" className="input" defaultValue={initial?.case_id ?? ""}>
            <option value="">—</option>
            {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مدیر پروژه" required>
            <select name="project_manager_id" required className="input" defaultValue={initial?.project_manager_id ?? ""}>
              <option value="">— انتخاب —</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
          <Field label="مالک داخلی">
            <select name="owner_user_id" className="input" defaultValue={initial?.owner_user_id ?? ""}>
              <option value="">—</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
        </div>

        <Field label="اولویت">
          <select name="priority" className="input" defaultValue={initial?.priority ?? "NORMAL"}>
            {PM_PRIORITY.map((p) => (<option key={p} value={p}>{PM_PRIORITY_LABEL[p]}</option>))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ شروع برنامه‌ریزی‌شده"><JalaliDateInput name="planned_start_date" defaultISO={initial?.planned_start_date} /></Field>
          <Field label="تاریخ پایان برنامه‌ریزی‌شده"><JalaliDateInput name="planned_end_date" defaultISO={initial?.planned_end_date} /></Field>
        </div>
        {docId && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="تاریخ شروع واقعی"><JalaliDateInput name="actual_start_date" defaultISO={initial?.actual_start_date} /></Field>
            <Field label="تاریخ پایان واقعی"><JalaliDateInput name="actual_end_date" defaultISO={initial?.actual_end_date} /></Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="بودجه"><MoneyInput name="budget_amount" defaultValue={initial?.budget_amount != null ? String(initial.budget_amount) : ""} /></Field>
          <Field label="واحد پول بودجه">
            <select name="budget_currency" className="input" defaultValue={initial?.budget_currency ?? ""}>
              <option value="">—</option>
              {CURRENCY.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </Field>
          <Field label="درصد پیشرفت">
            <input name="progress_percent" type="number" min={0} max={100} defaultValue={initial?.progress_percent ?? 0} className="input tnum" dir="ltr" />
          </Field>
        </div>

        <Field label="شرح پروژه"><textarea name="description" rows={3} defaultValue={initial?.description ?? ""} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">{docId ? "ذخیره تغییرات" : "ثبت پروژه"}</SubmitButton>
        <Link href="/projects" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

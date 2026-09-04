"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createOpportunity, updateOpportunity, type ActionState } from "@/app/actions/crm-opportunities";
import { Field, FormError, SubmitButton } from "@/components/form";
import { MoneyInput } from "@/components/MoneyInput";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { CRM_OPPORTUNITY_TYPE, CRM_OPPORTUNITY_TYPE_LABEL, CRM_OPPORTUNITY_PRIORITY, CRM_OPPORTUNITY_PRIORITY_LABEL, CURRENCY } from "@/lib/enums";

type Opt = { id: string; label: string };
type ContactOpt = Opt & { company_id: string };
type Stage = { id: string; name: string };
type Pipeline = { id: string; name: string; stages: Stage[] };

export function OpportunityForm({
  docId,
  companies,
  contacts,
  cases,
  pipelines,
  profiles,
  defaultCompanyId,
  initial,
}: {
  docId?: string;
  companies: Opt[];
  contacts: ContactOpt[];
  cases: Opt[];
  pipelines: Pipeline[];
  profiles: Opt[];
  defaultCompanyId?: string;
  initial?: {
    title: string;
    company_id: string;
    primary_contact_id: string | null;
    case_id: string | null;
    opportunity_type: string;
    pipeline_id: string;
    stage_id: string;
    owner_user_id: string | null;
    currency_code: string;
    estimated_value: number | null;
    probability: number | null;
    expected_close_date: string | null;
    source: string | null;
    priority: string;
    description: string | null;
    internal_notes: string | null;
    next_action: string | null;
    next_action_date: string | null;
  };
}) {
  const action = docId ? updateOpportunity : createOpportunity;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [companyId, setCompanyId] = useState(initial?.company_id ?? defaultCompanyId ?? "");
  const [pipelineId, setPipelineId] = useState(initial?.pipeline_id ?? pipelines[0]?.id ?? "");

  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const availableContacts = contacts.filter((c) => c.company_id === companyId);

  return (
    <form action={formAction} className="space-y-5">
      {docId && <input type="hidden" name="id" value={docId} />}
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="عنوان فرصت" required>
          <input name="title" required defaultValue={initial?.title ?? ""} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شرکت" required>
            <select name="company_id" required className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— انتخاب —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="فرد رابط">
            <select name="primary_contact_id" className="input" defaultValue={initial?.primary_contact_id ?? ""}>
              <option value="">—</option>
              {availableContacts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع فرصت">
            <select name="opportunity_type" className="input" defaultValue={initial?.opportunity_type ?? "TRADE"}>
              {CRM_OPPORTUNITY_TYPE.map((t) => (<option key={t} value={t}>{CRM_OPPORTUNITY_TYPE_LABEL[t]}</option>))}
            </select>
          </Field>
          <Field label="پروندهٔ مرتبط">
            <select name="case_id" className="input" defaultValue={initial?.case_id ?? ""}>
              <option value="">—</option>
              {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پایپ‌لاین" required>
            <select name="pipeline_id" required className="input" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
              {pipelines.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </Field>
          <Field label="مرحله" required>
            <select name="stage_id" required className="input" defaultValue={initial?.stage_id ?? stages[0]?.id ?? ""}>
              {stages.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مالک فرصت">
            <select name="owner_user_id" className="input" defaultValue={initial?.owner_user_id ?? ""}>
              <option value="">—</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
          <Field label="اولویت">
            <select name="priority" className="input" defaultValue={initial?.priority ?? "NORMAL"}>
              {CRM_OPPORTUNITY_PRIORITY.map((p) => (<option key={p} value={p}>{CRM_OPPORTUNITY_PRIORITY_LABEL[p]}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ارزش تخمینی">
            <MoneyInput name="estimated_value" defaultValue={initial?.estimated_value != null ? String(initial.estimated_value) : ""} />
          </Field>
          <Field label="واحد پول">
            <select name="currency_code" className="input" defaultValue={initial?.currency_code ?? "IRR"}>
              {CURRENCY.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </Field>
          <Field label="احتمال موفقیت (٪)">
            <input name="probability" type="number" min={0} max={100} defaultValue={initial?.probability ?? ""} className="input tnum" dir="ltr" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ تخمینی بستن"><JalaliDateInput name="expected_close_date" defaultISO={initial?.expected_close_date} /></Field>
          <Field label="منبع"><input name="source" defaultValue={initial?.source ?? ""} className="input" /></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اقدام بعدی"><input name="next_action" defaultValue={initial?.next_action ?? ""} className="input" /></Field>
          <Field label="تاریخ اقدام بعدی"><JalaliDateInput name="next_action_date" defaultISO={initial?.next_action_date} /></Field>
        </div>

        <Field label="شرح"><textarea name="description" rows={3} defaultValue={initial?.description ?? ""} className="input" /></Field>
        <Field label="یادداشت داخلی"><textarea name="internal_notes" rows={2} defaultValue={initial?.internal_notes ?? ""} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">{docId ? "ذخیره تغییرات" : "ثبت فرصت"}</SubmitButton>
        <Link href="/opportunities" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

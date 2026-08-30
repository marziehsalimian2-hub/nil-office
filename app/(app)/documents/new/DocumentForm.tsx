"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createDocument, type ActionState } from "@/app/actions/entities";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { DOCUMENT_TYPE, DOCUMENT_TYPE_LABEL } from "@/lib/enums";
type Opt = { id: string; label: string };
export function DocumentForm({ companies, cases }: { companies: Opt[]; cases: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createDocument, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="عنوان سند" required><input name="title" required className="input" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع سند">
            <select name="document_type" className="input" defaultValue="OTHER">
              {DOCUMENT_TYPE.map((t) => (<option key={t} value={t}>{DOCUMENT_TYPE_LABEL[t]}</option>))}
            </select>
          </Field>
          <Field label="نسخه"><input name="version" dir="ltr" className="input text-left" placeholder="v1" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شرکت مرتبط">
            <select name="company_id" className="input" defaultValue="">
              <option value="">— بدون شرکت —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="پروندهٔ مرتبط">
            <select name="case_id" className="input" defaultValue="">
              <option value="">— بدون پرونده —</option>
              {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ سند"><JalaliDateInput name="document_date" /></Field>
          <Field label="تاریخ دریافت"><JalaliDateInput name="received_date" /></Field>
        </div>
        <Field label="توضیحات"><textarea name="description" rows={3} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت سند</SubmitButton>
        <Link href="/documents" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

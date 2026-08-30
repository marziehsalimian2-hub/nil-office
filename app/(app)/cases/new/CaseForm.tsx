"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createCase, type ActionState } from "@/app/actions/entities";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { CASE_STATUS, CASE_STATUS_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function CaseForm({ companies, profiles }: { companies: Opt[]; profiles: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createCase, null);
  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="rounded-lg border border-seal/20 bg-seal-tint px-3 py-2 text-xs text-ink-muted">
          کد پرونده به‌صورت خودکار ساخته می‌شود (قالب: CASE-سال-شماره).
        </div>
        <Field label="عنوان پرونده" required>
          <input name="title" required className="input" placeholder="مثلاً تأمین گوگرد — افرا طب آوا" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع پرونده"><input name="case_type" className="input" placeholder="خرید، فروش، قرارداد…" /></Field>
          <Field label="شرکت مرتبط">
            <select name="company_id" className="input" defaultValue="">
              <option value="">— بدون شرکت —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="مسئول پرونده">
            <select name="responsible_user" className="input" defaultValue="">
              <option value="">— انتخاب —</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
          <Field label="تاریخ شروع"><JalaliDateInput name="start_date" /></Field>
          <Field label="وضعیت">
            <select name="status" className="input" defaultValue="ACTIVE">
              {CASE_STATUS.map((s) => (<option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>))}
            </select>
          </Field>
        </div>
        <Field label="برچسب‌ها" hint="با ویرگول جدا کنید">
          <input name="tags" className="input" placeholder="گوگرد، صادرات، افرا طب" />
        </Field>
        <Field label="توضیحات"><textarea name="description" rows={3} className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت پرونده</SubmitButton>
        <Link href="/cases" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

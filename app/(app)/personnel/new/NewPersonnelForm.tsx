"use client";
import { useActionState } from "react";
import Link from "next/link";
import { onboardPersonnel, type ActionState } from "@/app/actions/personnel";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { PERSONNEL_EMPLOYMENT_TYPE, PERSONNEL_EMPLOYMENT_TYPE_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function NewPersonnelForm({ managers, profiles }: { managers: Opt[]; profiles: Opt[] }) {
  const [state, run] = useActionState<ActionState, FormData>(onboardPersonnel, null);
  return (
    <form action={run} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام" required><input name="first_name" required className="input" /></Field>
          <Field label="نام خانوادگی" required><input name="last_name" required className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="سمت" required><input name="job_title" required className="input" /></Field>
          <Field label="نوع همکاری" required>
            <select name="employment_type" required className="input" defaultValue="">
              <option value="" disabled>— انتخاب —</option>
              {PERSONNEL_EMPLOYMENT_TYPE.map((t) => (<option key={t} value={t}>{PERSONNEL_EMPLOYMENT_TYPE_LABEL[t]}</option>))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاریخ استخدام" required><JalaliDateInput name="hire_date" required /></Field>
          <Field label="واحد"><input name="department" className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مدیر مستقیم">
            <select name="manager_personnel_id" className="input" defaultValue=""><option value="">—</option>
              {managers.map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
            </select>
          </Field>
          <Field label="محل کار"><input name="work_location" className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع برنامهٔ کاری"><input name="work_schedule_type" className="input" placeholder="تمام‌وقت، شیفتی، ..." /></Field>
          <Field label="حساب کاربری نیل آفیس (اختیاری)" hint="در صورت وجود، این پرونده به حساب کاربری فرد متصل می‌شود">
            <select name="profile_id" className="input" defaultValue=""><option value="">—</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="موبایل"><input name="mobile" dir="ltr" className="input tnum" /></Field>
          <Field label="ایمیل"><input name="email" dir="ltr" className="input" /></Field>
          <Field label="ساعات کاری استاندارد (ماهانه)"><input name="standard_monthly_hours" type="number" step="0.5" className="input tnum" /></Field>
        </div>
        <Field label="آدرس"><input name="address" className="input" /></Field>
        <Field label="یادداشت"><input name="notes" className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت پرسنل</SubmitButton>
        <Link href="/personnel" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

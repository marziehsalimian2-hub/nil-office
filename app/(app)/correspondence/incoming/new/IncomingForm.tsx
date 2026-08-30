"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createIncoming, type ActionState } from "@/app/actions/correspondence";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";

type Opt = { id: string; label: string };

export function IncomingForm({
  companies,
  cases,
  profiles,
}: {
  companies: Opt[];
  cases: Opt[];
  profiles: Opt[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createIncoming, null);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />

      <div className="card space-y-4 p-5">
        <div className="rounded-lg border border-seal/20 bg-seal-tint px-3 py-2 text-xs text-ink-muted">
          شمارهٔ ثبت وارده به‌صورت خودکار هنگام ذخیره صادر می‌شود (قالب: و-سال-شماره).
        </div>

        <Field label="موضوع نامه" required>
          <input name="subject" required className="input" placeholder="موضوع نامهٔ دریافتی" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شرکت فرستنده">
            <select name="sender_company_id" className="input" defaultValue="">
              <option value="">— انتخاب شرکت —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="شخص رابط">
            <input name="recipient_name" className="input" placeholder="نام فرستنده / رابط" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="شمارهٔ نامهٔ فرستنده">
            <input name="external_letter_number" dir="ltr" className="input text-center" />
          </Field>
          <Field label="تاریخ نامهٔ فرستنده">
            <JalaliDateInput name="external_letter_date" />
          </Field>
          <Field label="تاریخ دریافت">
            <JalaliDateInput name="sent_received_at" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پرونده مرتبط">
            <select name="case_id" className="input" defaultValue="">
              <option value="">— بدون پرونده —</option>
              {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="کاربر مسئول">
            <select name="assigned_to" className="input" defaultValue="">
              <option value="">— انتخاب کاربر —</option>
              {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" name="requires_response" value="true" className="h-4 w-4 accent-[#9a6a2e]" />
            <span className="text-sm text-ink">این نامه نیاز به پاسخ دارد</span>
          </label>
          <Field label="مهلت پاسخ / پیگیری">
            <JalaliDateInput name="followup_date" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="دریافت از طریق">
            <input name="sent_received_method" className="input" placeholder="پست، ایمیل، حضوری…" />
          </Field>
        </div>

        <Field label="یادداشت داخلی">
          <textarea name="internal_notes" rows={2} className="input" />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="seal">ثبت و اخذ شمارهٔ وارده</SubmitButton>
        <Link href="/correspondence/incoming" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

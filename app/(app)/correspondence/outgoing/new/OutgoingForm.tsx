"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createOutgoing, type ActionState } from "@/app/actions/correspondence";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { RichTextEditor } from "@/components/RichTextEditor";
import { LANGUAGE, LANGUAGE_LABEL, PRIORITY, PRIORITY_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function OutgoingForm({
  companies,
  cases,
  profiles,
}: {
  companies: Opt[];
  cases: Opt[];
  profiles: Opt[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createOutgoing, null);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />

      <div className="card space-y-4 p-5">
        <Field label="موضوع نامه" required>
          <input name="subject" required className="input" placeholder="موضوع را بنویسید" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شرکت گیرنده">
            <select name="recipient_company_id" className="input" defaultValue="">
              <option value="">— انتخاب شرکت —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="نام شخص / سمت گیرنده">
            <input name="recipient_name" className="input" placeholder="مثلاً جناب آقای…" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پرونده مرتبط">
            <select name="case_id" className="input" defaultValue="">
              <option value="">— بدون پرونده —</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="امضاکننده">
            <select name="signatory_id" className="input" defaultValue="">
              <option value="">— انتخاب امضاکننده —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="زبان">
            <select name="language" className="input" defaultValue="FA">
              {LANGUAGE.map((l) => (
                <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>
              ))}
            </select>
          </Field>
          <Field label="اولویت">
            <select name="priority" className="input" defaultValue="NORMAL">
              {PRIORITY.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </Field>
          <Field label="روش ارسال">
            <input name="sent_received_method" className="input" placeholder="پست، ایمیل، حضوری…" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" name="requires_response" value="true" className="h-4 w-4 accent-[#9a6a2e]" />
            <span className="text-sm text-ink">این نامه نیاز به پاسخ دارد</span>
          </label>
          <Field label="تاریخ پیگیری" hint="در صورت نیاز به پاسخ">
            <JalaliDateInput name="followup_date" />
          </Field>
        </div>

        <Field label="متن نامه" hint="اختیاری — با «دانلود PDF» در صفحهٔ نامه روی سربرگ رسمی نمایش داده می‌شود">
          <RichTextEditor name="draft_text" />
        </Field>

        <Field label="یادداشت داخلی">
          <textarea name="internal_notes" rows={2} className="input" placeholder="یادداشت داخلی (در نامه چاپ نمی‌شود)" />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton name="_submit" value="draft" variant="ghost">ذخیره پیش‌نویس</SubmitButton>
        <SubmitButton name="_submit" value="review" variant="primary">ارسال برای بررسی</SubmitButton>
        <Link href="/correspondence/outgoing" className="btn-quiet">انصراف</Link>
        <p className="mr-auto text-xs text-ink-muted">
          شماره رسمی فقط هنگام «ثبت نهایی» در صفحهٔ نامه صادر می‌شود.
        </p>
      </div>
    </form>
  );
}

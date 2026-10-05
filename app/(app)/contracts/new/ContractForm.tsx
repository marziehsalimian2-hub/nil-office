"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createContractDraft, type ActionState } from "@/app/actions/contracts";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { CONTRACT_STATUS, CONTRACT_STATUS_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function ContractForm({
  types,
  companies,
  cases,
  profiles,
}: {
  types: Opt[];
  companies: Opt[];
  cases: Opt[];
  profiles: Opt[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createContractDraft, null);
  const [isHistorical, setIsHistorical] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />

      <div className="card space-y-4 p-5">
        <Field label="عنوان قرارداد" required>
          <input name="title" required className="input" placeholder="عنوان قرارداد را بنویسید" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع قرارداد" required>
            <select name="contract_type_id" required className="input" defaultValue="">
              <option value="" disabled>— انتخاب نوع —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="طرف قرارداد (شرکت)">
            <select name="party_company_id" className="input" defaultValue="">
              <option value="">— انتخاب شرکت —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام/سمت نمایندهٔ طرف قرارداد">
            <input name="party_contact_name" className="input" />
          </Field>
          <Field label="پرونده مرتبط">
            <select name="case_id" className="input" defaultValue="">
              <option value="">— بدون پرونده —</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="تاریخ قرارداد"><JalaliDateInput name="contract_date" /></Field>
          <Field label="تاریخ نفوذ"><JalaliDateInput name="effective_date" /></Field>
          <Field label="تاریخ شروع"><JalaliDateInput name="start_date" /></Field>
          <Field label="تاریخ پایان"><JalaliDateInput name="end_date" /></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="مبلغ پایه"><MoneyInput name="base_amount" /></Field>
          <Field label="مالیات/ارزش‌افزوده"><MoneyInput name="tax_amount" /></Field>
          <Field label="مبلغ نهایی"><MoneyInput name="total_amount" /></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مسئول قرارداد">
            <select name="responsible_user_id" className="input" defaultValue="">
              <option value="">— انتخاب —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end gap-5 pb-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requires_guarantee" value="true" className="h-4 w-4 accent-[#9a6a2e]" />
              <span className="text-sm text-ink">نیاز به ضمانت‌نامه</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="auto_renewal" value="true" className="h-4 w-4 accent-[#9a6a2e]" />
              <span className="text-sm text-ink">تمدید خودکار</span>
            </label>
          </div>
        </div>

        <Field label="شرح قرارداد">
          <textarea name="description" rows={3} className="input" />
        </Field>
        <Field label="یادداشت داخلی">
          <textarea name="internal_notes" rows={2} className="input" placeholder="یادداشت داخلی (روی خروجی رسمی نمایش داده نمی‌شود)" />
        </Field>

        <div className="border-t border-paper-line/60 pt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_historical"
              value="true"
              checked={isHistorical}
              onChange={(e) => setIsHistorical(e.target.checked)}
              className="h-4 w-4 accent-[#9a6a2e]"
            />
            <span className="text-sm font-medium text-ink">قرارداد تاریخی / سابق</span>
          </label>
          <p className="mt-1 text-xs text-ink-muted">
            برای قراردادهایی که قبل از این سامانه امضا شده‌اند — شمارهٔ رسمی جدید نمی‌گیرند و شمارهٔ اصلی‌شان حفظ می‌شود.
          </p>
          {isHistorical && (
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="شمارهٔ اصلی قرارداد" required>
                <input name="original_contract_number" required className="input" dir="ltr" />
              </Field>
              <Field label="تاریخ اصلی قرارداد">
                <JalaliDateInput name="original_contract_date" />
              </Field>
              <Field label="وضعیت فعلی قرارداد" required>
                <select name="historical_status" required className="input" defaultValue="ACTIVE">
                  {CONTRACT_STATUS.map((s) => (
                    <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="primary">ذخیره پیش‌نویس</SubmitButton>
        <Link href="/contracts" className="btn-quiet">انصراف</Link>
        <p className="mr-auto text-xs text-ink-muted">
          شمارهٔ رسمی فقط هنگام «تأیید» قرارداد صادر می‌شود.
        </p>
      </div>
    </form>
  );
}

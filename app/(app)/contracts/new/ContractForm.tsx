"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createContractDraft, type ActionState } from "@/app/actions/contracts";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { CONTRACT_KIND, CONTRACT_KIND_LABEL, type ContractKind } from "@/lib/enums";

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
  const [kind, setKind] = useState<ContractKind>("NIL_ISSUED");

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="عنوان قرارداد" required>
            <input name="title" required className="input" />
          </Field>
          <Field label="نوع قرارداد" required>
            <select name="contract_type_id" required className="input" defaultValue="">
              <option value="" disabled>
                — انتخاب —
              </option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="دستهٔ قرارداد" required hint="قرارداد سابق برای وارد کردن قراردادهایی که پیش از این ثبت شده‌اند و باید شمارهٔ اصلی خود را حفظ کنند.">
          <div className="flex gap-4">
            {CONTRACT_KIND.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="accent-[#9a6a2e]"
                />
                {CONTRACT_KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </Field>

        {kind === "HISTORICAL" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="شمارهٔ اصلی قرارداد" required>
              <input name="external_contract_number" required dir="ltr" className="input text-center tnum" />
            </Field>
            <Field label="یادداشت منبع">
              <input name="external_source_note" className="input" />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="طرف قرارداد">
            <select name="counterparty_company_id" className="input" defaultValue="">
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="پروندهٔ مرتبط">
            <select name="case_id" className="input" defaultValue="">
              <option value="">—</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مسئول قرارداد">
            <select name="responsible_user" className="input" defaultValue="">
              <option value="">—</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="امضاکننده" hint="امضای این شخص در برگ خلاصهٔ قرارداد چاپ می‌شود">
            <select name="signatory_id" className="input" defaultValue="">
              <option value="">— انتخاب امضاکننده —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="نام/سمت زیر امضا" hint="اختیاری — هر خط جدا زیر امضا و مهر چاپ می‌شود؛ برای خط بعدی Enter بزنید">
          <textarea name="signatory_label" rows={2} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="تاریخ عقد">
            <JalaliDateInput name="signed_date" />
          </Field>
          <Field label="تاریخ شروع">
            <JalaliDateInput name="effective_date" />
          </Field>
          <Field label="تاریخ پایان">
            <JalaliDateInput name="expiry_date" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="مبلغ پایه">
            <MoneyInput name="base_amount" />
          </Field>
          <Field label="تخفیف">
            <MoneyInput name="discount_amount" />
          </Field>
          <Field label="مالیات/ارزش‌افزوده">
            <MoneyInput name="tax_amount" />
          </Field>
        </div>
        <Field label="واحد پول">
          <input name="currency_code" defaultValue="IRR" dir="ltr" className="input w-32 text-center tnum" />
        </Field>

        <Field label="شرح قرارداد">
          <textarea name="description" rows={3} className="input" />
        </Field>
        <Field label="یادداشت داخلی">
          <textarea name="internal_notes" rows={2} className="input" />
        </Field>
      </div>

      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت پیش‌نویس</SubmitButton>
        <Link href="/contracts" className="btn-quiet">
          انصراف
        </Link>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createChequePrintTemplate, type ActionState } from "@/app/actions/cheques";
import { Field, FormError, SubmitButton } from "@/components/form";

type Opt = { id: string; label: string };

export function ChequeTemplateForm({ bankAccounts }: { bankAccounts: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createChequePrintTemplate, null);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="نام قالب" required>
          <input name="name" required className="input" />
        </Field>
        <Field label="حساب بانکی مخصوص" hint="اختیاری — اگر خالی بماند، این قالب برای همهٔ بانک‌ها قابل‌استفاده است">
          <select name="bank_account_id" className="input" defaultValue="">
            <option value="">همهٔ بانک‌ها</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="عرض برگه (mm)" required>
            <input name="page_width_mm" type="number" step="0.1" required dir="ltr" className="input text-center tnum" defaultValue="165" />
          </Field>
          <Field label="ارتفاع برگه (mm)" required>
            <input name="page_height_mm" type="number" step="0.1" required dir="ltr" className="input text-center tnum" defaultValue="80" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="جهت صفحه">
            <select name="orientation" className="input" defaultValue="LANDSCAPE">
              <option value="LANDSCAPE">افقی</option>
              <option value="PORTRAIT">عمودی</option>
            </select>
          </Field>
          <Field label="فرمت تاریخ چاپی">
            <select name="print_date_format" className="input" defaultValue="JALALI">
              <option value="JALALI">جلالی</option>
              <option value="GREGORIAN">میلادی</option>
            </select>
          </Field>
        </div>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ساخت قالب</SubmitButton>
        <Link href="/cheques/templates" className="btn-quiet">
          انصراف
        </Link>
      </div>
    </form>
  );
}

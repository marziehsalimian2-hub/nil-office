"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createSalaryComponent, createSalaryComponentVersion, type ActionState } from "@/app/actions/payroll-components";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import {
  SALARY_COMPONENT_TYPE, SALARY_COMPONENT_TYPE_LABEL, SALARY_CALCULATION_METHOD, SALARY_CALCULATION_METHOD_LABEL,
  DEFERRED_CALCULATION_METHODS, PAYROLL_PERCENTAGE_BASIS, PAYROLL_PERCENTAGE_BASIS_LABEL, CURRENCY, CURRENCY_LABEL,
  SUGGESTED_SALARY_COMPONENTS, SUGGESTED_RULE_KEYS,
  type SalaryComponentType, type SalaryCalculationMethod,
} from "@/lib/enums";
import type { SalaryComponentVersion } from "@/lib/types/database";

export function ComponentForm({
  mode,
  componentId,
  componentType,
  initial,
}: {
  mode: "create" | "version";
  componentId?: string;
  componentType?: SalaryComponentType;
  initial?: SalaryComponentVersion;
}) {
  const [state, run] = useActionState<ActionState, FormData>(mode === "create" ? createSalaryComponent : createSalaryComponentVersion, null);
  const [type, setType] = useState<SalaryComponentType>(componentType ?? "EARNING");
  const [method, setMethod] = useState<SalaryCalculationMethod>(initial?.calculation_method ?? "FIXED");
  const [fixed, setFixed] = useState(initial?.fixed_amount != null ? String(initial.fixed_amount) : "");
  const [nameFa, setNameFa] = useState(initial?.name_fa ?? "");
  const [code, setCode] = useState("");

  const isEarning = type === "EARNING";
  const deferred = DEFERRED_CALCULATION_METHODS.includes(method);

  function onCodeChange(v: string) {
    const upper = v.toUpperCase();
    setCode(upper);
    const hit = SUGGESTED_SALARY_COMPONENTS.find((s) => s.code === upper);
    if (hit) {
      if (!nameFa) setNameFa(hit.name_fa);
      setType(hit.type);
    }
  }

  return (
    <form action={run} className="space-y-5">
      <FormError message={state?.error} />
      {mode === "version" && <input type="hidden" name="component_id" value={componentId} />}
      <div className="card space-y-4 p-5">
        {mode === "create" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="کد جزء" required hint="حروف بزرگ لاتین، رقم و خط زیر؛ پس از ثبت قابل تغییر نیست">
              <input name="code" required dir="ltr" list="component-code-suggestions" className="input" value={code} onChange={(e) => onCodeChange(e.target.value)} />
              <datalist id="component-code-suggestions">
                {SUGGESTED_SALARY_COMPONENTS.map((s) => (<option key={s.code} value={s.code}>{s.name_fa}</option>))}
              </datalist>
            </Field>
            <Field label="نوع جزء" required hint="پس از ثبت قابل تغییر نیست">
              <select name="component_type" required className="input" value={type} onChange={(e) => setType(e.target.value as SalaryComponentType)}>
                {SALARY_COMPONENT_TYPE.map((t) => (<option key={t} value={t}>{SALARY_COMPONENT_TYPE_LABEL[t]}</option>))}
              </select>
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام فارسی" required><input name="name_fa" required className="input" value={nameFa} onChange={(e) => setNameFa(e.target.value)} /></Field>
          <Field label="نام انگلیسی"><input name="name_en" dir="ltr" className="input" defaultValue={initial?.name_en ?? ""} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="روش محاسبه" required>
            <select name="calculation_method" required className="input" value={method} onChange={(e) => setMethod(e.target.value as SalaryCalculationMethod)}>
              {SALARY_CALCULATION_METHOD.map((m) => (<option key={m} value={m}>{SALARY_CALCULATION_METHOD_LABEL[m]}</option>))}
            </select>
          </Field>
          <Field label="معتبر از" required><JalaliDateInput name="effective_from" required /></Field>
        </div>

        {deferred && (
          <p className="rounded-lg border border-paper-line bg-paper/60 px-3 py-2 text-xs text-ink-muted">
            این روش تعریف می‌شود اما در این فاز ارزیابی نمی‌شود؛ هیچ فرمولی ذخیره نمی‌شود و محاسبه در فاز موتور محاسبه انجام خواهد شد.
          </p>
        )}

        {method === "FIXED" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="مبلغ ثابت پیش‌فرض"><MoneyInput name="fixed_amount" value={fixed} onChange={setFixed} /></Field>
            <Field label="واحد پول">
              <select name="currency" className="input" defaultValue={initial?.currency ?? ""}>
                <option value="">— انتخاب —</option>
                {CURRENCY.map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}
              </select>
            </Field>
          </div>
        )}
        {method === "PERCENTAGE" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="درصد پیش‌فرض (اختیاری اگر به قاعدهٔ قانونی وصل شود)">
              <input name="percentage" dir="ltr" inputMode="decimal" className="input tnum" defaultValue={initial?.percentage != null ? String(initial.percentage) : ""} />
            </Field>
            <Field label="مبنای محاسبهٔ درصد" required>
              <select name="percentage_basis" required className="input" defaultValue={initial?.percentage_basis ?? ""}>
                <option value="" disabled>— انتخاب —</option>
                {PAYROLL_PERCENTAGE_BASIS.map((b) => (<option key={b} value={b}>{PAYROLL_PERCENTAGE_BASIS_LABEL[b]}</option>))}
              </select>
            </Field>
          </div>
        )}
        {(method === "PERCENTAGE" || method === "FORMULA") && (
          <Field label="اتصال به قاعدهٔ قانونی (کلید قاعده)" hint="در صورت پر شدن، مقدار در زمان محاسبه از مجموعه قاعدهٔ تأییدشده خوانده می‌شود؛ با مبلغ/درصد دستی هم‌زمان مجاز نیست">
            <input name="rule_key" dir="ltr" list="rule-key-suggestions" className="input" defaultValue={initial?.rule_key ?? ""} />
            <datalist id="rule-key-suggestions">
              {SUGGESTED_RULE_KEYS.map((k) => (<option key={k.key} value={k.key}>{k.label_fa}</option>))}
            </datalist>
          </Field>
        )}

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="taxable" disabled={!isEarning} defaultChecked={initial?.taxable ?? false} /> مشمول مالیات
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="insurable" disabled={!isEarning} defaultChecked={initial?.insurable ?? false} /> مشمول بیمه
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="display_on_payslip" defaultChecked={initial?.display_on_payslip ?? true} /> نمایش در فیش حقوقی
          </label>
        </div>
        {!isEarning && <p className="text-xs text-ink-muted">گزینه‌های «مشمول مالیات/بیمه» فقط برای اجزای نوع «مزایا» قابل تعیین است.</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ترتیب نمایش"><input name="display_order" type="number" min={0} className="input tnum" defaultValue={initial?.display_order ?? 0} /></Field>
          <Field label="یادداشت تغییر"><input name="change_note" className="input" /></Field>
        </div>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">{mode === "create" ? "ثبت جزء حقوقی" : "ثبت نسخهٔ جدید"}</SubmitButton>
        {mode === "create" && <Link href="/payroll/components" className="btn-quiet">انصراف</Link>}
      </div>
      {mode === "version" && (
        <p className="text-xs text-ink-muted">
          نسخهٔ قبلی از تاریخ «معتبر از» بسته و قفل می‌شود. حقوق‌های ثبت‌شده با نسخهٔ قدیمی، همان تعریف قدیمی را حفظ می‌کنند و فقط با ثبت نسخهٔ جدید حقوق، تعریف جدید را می‌گیرند.
        </p>
      )}
    </form>
  );
}

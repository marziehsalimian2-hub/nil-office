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
  QUANTITY_SOURCE, QUANTITY_SOURCE_LABEL, QUANTITY_RATE_MODE, QUANTITY_RATE_MODE_LABEL, quantityUnitOf, QUANTITY_UNIT_LABEL,
  type SalaryComponentType, type SalaryCalculationMethod, type QuantitySource, type QuantityRateMode,
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
  // QUANTITY_X_RATE (Phase 8): divisor and multiplier are each ONE of: a number on the component, or an APPROVED rule key
  const [quantitySource, setQuantitySource] = useState<QuantitySource>((initial?.quantity_source as QuantitySource | null) ?? "OVERTIME_HOURS");
  const [rateMode, setRateMode] = useState<QuantityRateMode>((initial?.rate_mode as QuantityRateMode | null) ?? "WAGE_FRACTION");
  const [divisorMode, setDivisorMode] = useState<"NUMBER" | "RULE">(initial?.divisor_rule_key ? "RULE" : "NUMBER");
  const [multiplierMode, setMultiplierMode] = useState<"NUMBER" | "RULE">(initial?.multiplier_rule_key ? "RULE" : "NUMBER");
  const unit = quantityUnitOf(quantitySource);

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
            این روش تعریف می‌شود اما ارزیابی نمی‌شود؛ هیچ فرمولی ذخیره نمی‌شود و مبلغی از آن محاسبه نخواهد شد.
          </p>
        )}

        {method === "QUANTITY_X_RATE" && (
          <div className="space-y-4 rounded-lg border border-paper-line bg-paper/40 p-4">
            <p className="text-xs text-ink-muted">
              مبلغ = مقدار (از «کارکرد ماهانه») × نرخ. هیچ عدد قانونی از پیش تعیین نشده است: هر عدد را شما وارد می‌کنید یا به یک قاعدهٔ قانونی «تأییدشده» وصل می‌کنید؛
              اگر عددی نباشد، محاسبه برای همان ردیف متوقف می‌شود و هشدار بحرانی می‌دهد. نوع جزء (مزایا یا کسورات) تعیین می‌کند مبلغ اضافه یا کم شود.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="مقدار از کدام ستون کارکرد خوانده شود؟" required>
                <select name="quantity_source" required className="input" value={quantitySource} onChange={(e) => setQuantitySource(e.target.value as QuantitySource)}>
                  {QUANTITY_SOURCE.map((q) => (<option key={q} value={q}>{QUANTITY_SOURCE_LABEL[q]}</option>))}
                </select>
              </Field>
              <Field label="نحوهٔ تعیین نرخ" required>
                <select name="rate_mode" required className="input" value={rateMode} onChange={(e) => setRateMode(e.target.value as QuantityRateMode)}>
                  {QUANTITY_RATE_MODE.map((m) => (<option key={m} value={m}>{QUANTITY_RATE_MODE_LABEL[m]}</option>))}
                </select>
              </Field>
            </div>

            {rateMode === "PER_UNIT" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`نرخ هر ${QUANTITY_UNIT_LABEL[unit]}`} required hint="برای هر فرد می‌توان در پروفایل حقوقی نرخ جداگانه (جایگزین) ثبت کرد">
                  <MoneyInput name="fixed_amount" value={fixed} onChange={setFixed} />
                </Field>
                <Field label="واحد پول" required>
                  <select name="currency" required className="input" defaultValue={initial?.currency ?? ""}>
                    <option value="">— انتخاب —</option>
                    {CURRENCY.map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}
                  </select>
                </Field>
              </div>
            )}

            {rateMode === "WAGE_FRACTION" && (
              <div className="space-y-4">
                <p className="text-xs text-ink-muted">
                  نرخ = دستمزد ÷ مبنای ماه × ضریب. دستمزد = حقوق پایه؛ مگر برای مقدارهای ساعتی که در پروفایل حقوقی فرد «نرخ ساعتی» صریح ثبت شده باشد
                  (آن‌وقت همان نرخ ساعتی × ضریب به‌کار می‌رود و مبنای ماه استفاده نمی‌شود).
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={`مبنای ماه (تعداد ${QUANTITY_UNIT_LABEL[unit]} در ماه)`} required>
                    <div className="space-y-2">
                      <select className="input" value={divisorMode} onChange={(e) => setDivisorMode(e.target.value as "NUMBER" | "RULE")}>
                        <option value="NUMBER">عدد روی همین جزء</option>
                        <option value="RULE">از قاعدهٔ قانونی تأییدشده</option>
                      </select>
                      {divisorMode === "NUMBER" ? (
                        <input name="unit_divisor" required dir="ltr" inputMode="decimal" className="input tnum" defaultValue={initial?.unit_divisor != null ? String(initial.unit_divisor) : ""} />
                      ) : (
                        <input name="divisor_rule_key" required dir="ltr" placeholder="rule_key" className="input" defaultValue={initial?.divisor_rule_key ?? ""} />
                      )}
                      {divisorMode === "RULE" && <p className="text-xs text-ink-muted">واحد قاعده باید {unit} باشد.</p>}
                    </div>
                  </Field>
                  <Field label="ضریب (مثلاً ضریب اضافه‌کاری؛ برای کسر غیبت معمولاً ۱)" required>
                    <div className="space-y-2">
                      <select className="input" value={multiplierMode} onChange={(e) => setMultiplierMode(e.target.value as "NUMBER" | "RULE")}>
                        <option value="NUMBER">عدد روی همین جزء</option>
                        <option value="RULE">از قاعدهٔ قانونی تأییدشده</option>
                      </select>
                      {multiplierMode === "NUMBER" ? (
                        <input name="rate_multiplier" required dir="ltr" inputMode="decimal" className="input tnum" defaultValue={initial?.rate_multiplier != null ? String(initial.rate_multiplier) : ""} />
                      ) : (
                        <input name="multiplier_rule_key" required dir="ltr" placeholder="rule_key" className="input" defaultValue={initial?.multiplier_rule_key ?? ""} />
                      )}
                      {multiplierMode === "RULE" && <p className="text-xs text-ink-muted">واحد قاعده باید RATIO باشد.</p>}
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </div>
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

        {method === "FIXED" && (
          <div className="rounded-lg border border-line p-3">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="prorate_on_partial_period" defaultChecked={initial?.prorate_on_partial_period ?? false} /> در ماه ناقص (استخدام یا پایان همکاری در میانهٔ ماه) متناسب با روزهای کارکرد محاسبه شود
            </label>
            <p className="mt-1 text-xs text-ink-muted">تناسب تقویمی: مبلغ × روزهای استخدامی ÷ روزهای ماه. حقوق پایه همیشه متناسب می‌شود؛ این گزینه فقط برای همین جزء است. اینکه کدام مزایا باید متناسب شوند تصمیم شرکت (حسابدار) است. مزایای درصدی خودکار تابع مبنای خود هستند.</p>
          </div>
        )}

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

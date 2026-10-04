import { z } from "zod";
import {
  PAYROLL_ROLE, SALARY_COMPONENT_TYPE, SALARY_CALCULATION_METHOD, PAYROLL_PERCENTAGE_BASIS,
  PAYMENT_FREQUENCY, CURRENCY, LEGAL_RULE_SET_STATUS, PAYROLL_ROUNDING_MODE, PAYROLL_BATCH_STATUS, ELIGIBILITY_DECISION,
} from "@/lib/enums";
import { normalizeIban, normalizeDigits, isValidIranSheba, isValidCardNumber } from "@/lib/payroll/bank-validation";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");
const optIsoDate = isoDate.optional().or(z.literal("").transform(() => undefined));
// Money/rates travel as exact decimal STRINGS — never Number() (no float, no browser arithmetic).
const moneyStr = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "مبلغ نامعتبر است.");
const optMoney = moneyStr.optional().or(z.literal("").transform(() => undefined));
const rateStr = z.string().trim().regex(/^\d+(\.\d{1,6})?$/, "مقدار عددی نامعتبر است.");
const optRate = rateStr.optional().or(z.literal("").transform(() => undefined));
const pctStr = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "درصد نامعتبر است.").refine((v) => Number(v) <= 100, "درصد نامعتبر است.");
const optPct = pctStr.optional().or(z.literal("").transform(() => undefined));
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const optCurrency = z.enum(CURRENCY).optional().or(z.literal("").transform(() => undefined));
const optBasis = z.enum(PAYROLL_PERCENTAGE_BASIS).optional().or(z.literal("").transform(() => undefined));
const ruleKey = z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/, "کلید قاعده نامعتبر است.");

export const payrollRoleSchema = z.object({
  user_id: z.string().uuid(),
  payroll_role: z.enum(PAYROLL_ROLE).nullish(),
});

/* ------------------------------ salary components ------------------------------ */

const componentFields = {
  name_fa: z.string().trim().min(1, "درج نام فارسی الزامی است."),
  name_en: optText,
  calculation_method: z.enum(SALARY_CALCULATION_METHOD),
  effective_from: isoDate,
  fixed_amount: optMoney,
  currency: optCurrency,
  percentage: optPct,
  percentage_basis: optBasis,
  rule_key: ruleKey.optional().or(z.literal("").transform(() => undefined)),
  taxable: checkbox,
  insurable: checkbox,
  display_on_payslip: checkbox,
  display_order: z.coerce.number().int().min(0).default(0),
  change_note: optText,
};

type ComponentShape = {
  calculation_method: string; fixed_amount?: string; currency?: string; percentage?: string;
  percentage_basis?: string; rule_key?: string;
};
// The DB CHECKs (0115) remain the backstop; this gives a clear Persian message first.
function refineComponent(d: ComponentShape, ctx: z.RefinementCtx) {
  const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (d.fixed_amount !== undefined) {
    if (d.calculation_method !== "FIXED") bad("مبلغ ثابت فقط برای روش «مبلغ ثابت» مجاز است.");
    if (!d.currency) bad("برای مبلغ ثابت، انتخاب واحد پول الزامی است.");
  }
  if (d.calculation_method === "FIXED" && d.currency && d.fixed_amount === undefined) bad("مبلغ ثابت را وارد کنید.");
  if (d.percentage !== undefined && d.calculation_method !== "PERCENTAGE") bad("درصد فقط برای روش «درصدی» مجاز است.");
  if (d.calculation_method === "PERCENTAGE" && !d.percentage_basis) bad("برای روش درصدی، مبنای محاسبه الزامی است.");
  if (d.calculation_method !== "PERCENTAGE" && d.percentage_basis) bad("مبنای درصد فقط برای روش «درصدی» مجاز است.");
  if (d.rule_key) {
    if (d.calculation_method !== "PERCENTAGE" && d.calculation_method !== "FORMULA") bad("اتصال به قاعدهٔ قانونی فقط برای روش درصدی یا فرمول مجاز است.");
    if (d.fixed_amount !== undefined || d.percentage !== undefined) bad("اتصال به قاعدهٔ قانونی با مبلغ ثابت یا درصد دستی هم‌زمان مجاز نیست.");
  }
}

export const salaryComponentCreateSchema = z
  .object({
    ...componentFields,
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "کد جزء نامعتبر است (حروف بزرگ لاتین، رقم و خط زیر)."),
    component_type: z.enum(SALARY_COMPONENT_TYPE),
  })
  .superRefine(refineComponent);

export const salaryComponentVersionSchema = z
  .object({ ...componentFields, component_id: z.string().uuid() })
  .superRefine(refineComponent);

/* ------------------------------- compensation ------------------------------- */

const lineSchema = z.object({
  component_id: z.string().uuid(),
  amount_override: moneyStr.nullish(),
  percentage_override: pctStr.nullish(),
  notes: z.string().trim().nullish(),
});

export const compensationVersionSchema = z
  .object({
    effective_from: isoDate,
    base_salary: moneyStr,
    currency: z.enum(CURRENCY, { errorMap: () => ({ message: "واحد پول را انتخاب کنید." }) }),
    payment_frequency: z.enum(PAYMENT_FREQUENCY),
    hourly_rate: optMoney,
    notes: optText,
    lines: z.preprocess((v) => {
      try {
        return JSON.parse(String(v || "[]"));
      } catch {
        return null;
      }
    }, z.array(lineSchema, { invalid_type_error: "ردیف‌های اجزای حقوق نامعتبر است." })),
  })
  .superRefine((d, ctx) => {
    if (d.payment_frequency === "HOURLY" && d.hourly_rate === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "برای دورهٔ پرداخت ساعتی، نرخ ساعتی الزامی است." });
  });

/* --------------------------- payment destinations --------------------------- */

export const paymentDestinationSchema = z
  .object({
    bank_name: z.string().trim().min(1, "نام بانک الزامی است."),
    account_holder_name: z.string().trim().min(1, "نام صاحب حساب الزامی است."),
    account_number: optText.transform((v) => (v ? normalizeDigits(v) : undefined)),
    iban: optText.transform((v) => (v ? normalizeIban(v) : undefined)),
    card_number: optText.transform((v) => (v ? normalizeDigits(v) : undefined)),
    is_primary: checkbox,
    notes: optText,
  })
  .superRefine((d, ctx) => {
    if (!d.account_number && !d.iban && !d.card_number)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "حداقل یکی از شمارهٔ حساب، شبا یا شمارهٔ کارت باید وارد شود." });
    if (d.iban && !isValidIranSheba(d.iban))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "شمارهٔ شبا نامعتبر است." });
    if (d.card_number && !isValidCardNumber(d.card_number))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "شمارهٔ کارت نامعتبر است." });
  });

/* ------------------------------- legal rule sets ------------------------------- */

const rangeRefine = (d: { effective_from: string; effective_to?: string }, ctx: z.RefinementCtx) => {
  if (d.effective_to && d.effective_to <= d.effective_from)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "تاریخ پایان باید بعد از تاریخ شروع باشد." });
};

export const legalRuleSetSchema = z
  .object({
    name: z.string().trim().min(1, "نام مجموعه قانون الزامی است."),
    jurisdiction: z.string().trim().min(1, "حوزهٔ قانونی الزامی است."),
    effective_from: isoDate,
    effective_to: optIsoDate,
    source_reference: optText,
    copy_from_id: optUuid,
  })
  .superRefine(rangeRefine);

export const legalRuleSetHeaderSchema = z
  .object({ effective_from: isoDate, effective_to: optIsoDate, source_reference: optText })
  .superRefine(rangeRefine);

export const legalRuleEntrySchema = z
  .object({
    rule_key: ruleKey,
    value_numeric: optRate,
    value_json: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" ? undefined : v))
      .refine((v) => {
        if (v === undefined) return true;
        try {
          const parsed = JSON.parse(v);
          return typeof parsed === "object" && parsed !== null;
        } catch {
          return false;
        }
      }, "مقدار ساختاریافته باید یک JSON معتبر (شیء یا آرایه) باشد."),
    unit: optText,
    description: optText,
    source_reference: optText,
  })
  .superRefine((d, ctx) => {
    if (d.value_numeric === undefined && d.value_json === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "حداقل یکی از مقدار عددی یا مقدار ساختاریافته (JSON) باید وارد شود." });
  });

export const legalRuleSetStatusSchema = z.object({
  new_status: z.enum(LEGAL_RULE_SET_STATUS),
  note: optText,
});

/* ------------------- Phase 3: periods, work data, batches ------------------- */

export const payrollPeriodSchema = z.object({
  jalali_year: z.coerce.number().int().min(1300).max(1500),
  jalali_month: z.coerce.number().int().min(1).max(12),
});

const jurisdictionField = z.string().trim().optional().transform((v) => (v ? v : undefined));
const roundingScale = z.coerce.number().int().min(0, "تعداد رقم اعشار نامعتبر است.").max(4, "تعداد رقم اعشار نامعتبر است.");

export const payrollBatchSchema = z.object({
  period_id: z.string().uuid(),
  currency: z.enum(CURRENCY, { errorMap: () => ({ message: "واحد پول را انتخاب کنید." }) }),
  rounding_scale: roundingScale,
  rounding_mode: z.enum(PAYROLL_ROUNDING_MODE),
  jurisdiction: jurisdictionField,
  notes: optText,
});

export const batchSettingsSchema = z.object({
  batch_id: z.string().uuid(),
  rounding_scale: roundingScale,
  rounding_mode: z.enum(PAYROLL_ROUNDING_MODE),
  jurisdiction: jurisdictionField,
});

export const eligibilityOverrideSchema = z
  .object({
    batch_id: z.string().uuid(),
    personnel_id: z.string().uuid(),
    decision: z.enum(ELIGIBILITY_DECISION),
    reason: optText,
  })
  .superRefine((d, ctx) => {
    if (d.decision !== "AUTO" && !d.reason)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "درج دلیل الزامی است." });
  });

export const batchStatusSchema = z.object({
  batch_id: z.string().uuid(),
  new_status: z.enum(PAYROLL_BATCH_STATUS),
  note: optText,
});

// Quantities (days/hours): exact decimal strings, never Number().
const qty = z.string().trim().regex(/^\d{1,5}(\.\d{1,2})?$/, "مقدار کارکرد نامعتبر است.");
const optQty = qty.optional().or(z.literal("").transform(() => undefined)).or(z.null().transform(() => undefined));

export const workDataRowSchema = z.object({
  personnel_id: z.string().uuid(),
  work_days: optQty,
  work_hours: optQty,
  overtime_hours: optQty,
  absence_days: optQty,
  absence_hours: optQty,
  paid_leave_days: optQty,
  unpaid_leave_days: optQty,
  mission_days: optQty,
  mission_hours: optQty,
  notes: optText.or(z.null().transform(() => undefined)),
  inputs: z
    .array(
      z.object({
        component_id: z.string().uuid(),
        amount: moneyStr,
        currency: z.enum(CURRENCY),
        note: optText.or(z.null().transform(() => undefined)),
      }),
    )
    .default([]),
});
export type WorkDataRowInput = z.infer<typeof workDataRowSchema>;

/** The grid posts one JSON string of dirty rows. */
export const workDataRowsSchema = z.object({
  period_id: z.string().uuid(),
  rows: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "دادهٔ کارکرد نامعتبر است." });
        return z.NEVER;
      }
    })
    .pipe(z.array(workDataRowSchema).min(1, "تغییری برای ذخیره وجود ندارد.").max(500)),
});

/* ------------------- Phase 4: approval, reopen, accounting mapping ------------------- */

export const approveBatchSchema = z.object({ batch_id: z.string().uuid(), note: optText });

export const reopenBatchSchema = z.object({
  batch_id: z.string().uuid(),
  reason: z.string().trim().min(1, "درج دلیل بازگشایی الزامی است."),
});

export const accountingSettingsSchema = z.object({
  base_salary_expense: z.string().uuid("حساب هزینهٔ حقوق پایه را انتخاب کنید."),
  net_payable: z.string().uuid("حساب حقوق پرداختنی را انتخاب کنید."),
});

export const componentAccountsSchema = z.object({
  component_id: z.string().uuid(),
  expense: optUuid,
  liability: optUuid,
});

/* ------------------- Phase 5: salary payment drafts ------------------- */

export const paymentDraftsSchema = z.object({
  batch_id: z.string().uuid(),
  bank_account_id: z.string().uuid("حساب بانکی/صندوق را انتخاب کنید."),
  payment_date: isoDate,
  method: optText,
  items: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "فهرست پرداخت نامعتبر است." });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.object({ result_id: z.string().uuid(), amount: moneyStr })).min(1, "حداقل یک نفر را انتخاب کنید.").max(500)),
});


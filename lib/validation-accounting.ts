import { z } from "zod";
import { ACCOUNT_TYPE, ACCOUNT_NATURE, DETAIL_KIND, ACCOUNTING_ROLE } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");
const optIsoDate = isoDate.optional().or(z.literal("").transform(() => undefined));

export const fiscalYearSchema = z.object({
  title: z.string().trim().min(1, "عنوان سال مالی الزامی است."),
  start_date: isoDate,
  end_date: isoDate,
});

export const accountSchema = z.object({
  code: z.string().trim().min(1, "کد حساب الزامی است."),
  name: z.string().trim().min(1, "نام حساب الزامی است."),
  parent_id: optUuid,
  level: z.coerce.number().int().min(1).max(4),
  nature: z.enum(ACCOUNT_NATURE),
  account_type: z.enum(ACCOUNT_TYPE),
  allows_posting: z.coerce.boolean().default(false),
  is_active: z.coerce.boolean().default(true),
});

export const detailAccountSchema = z.object({
  name: z.string().trim().min(1, "نام تفصیلی الزامی است."),
  kind: z.enum(DETAIL_KIND).default("OTHER"),
  code: optText,
  company_id: optUuid,
});

export const bankAccountSchema = z.object({
  kind: z.enum(["BANK", "CASH"]).default("BANK"),
  account_title: z.string().trim().min(1, "عنوان حساب الزامی است."),
  bank_name: optText,
  branch: optText,
  account_number: optText,
  iban: optText,
  currency_code: z.string().trim().default("IRR"),
  account_id: optUuid,
});

export const journalHeaderSchema = z.object({
  fiscal_year_id: z.string().uuid("سال مالی را انتخاب کنید."),
  document_date: isoDate,
  description: optText,
  reference: optText,
});

export const journalLineSchema = z
  .object({
    account_id: z.string().uuid(),
    detail_account_id: z.string().uuid().nullish(),
    description: z.string().nullish(),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    company_id: z.string().uuid().nullish(),
    case_id: z.string().uuid().nullish(),
  })
  .refine((l) => !(l.debit > 0 && l.credit > 0), "هر ردیف یا بدهکار است یا بستانکار.")
  .refine((l) => l.debit > 0 || l.credit > 0, "مبلغ ردیف نمی‌تواند صفر باشد.");

export const cashDocSchema = z.object({
  date: isoDate,
  counterparty: optText, // payer / payee
  amount: z.coerce.number().positive("مبلغ باید بزرگ‌تر از صفر باشد."),
  currency_code: z.string().trim().default("IRR"),
  bank_account_id: z.string().uuid("حساب بانکی/صندوق را انتخاب کنید."),
  counterpart_account_id: z.string().uuid("حساب طرف مقابل را انتخاب کنید."),
  detail_account_id: optUuid,
  method: optText,
  reference: optText,
  description: optText,
  company_id: optUuid,
  case_id: optUuid,
  fiscal_year_id: z.string().uuid("سال مالی را انتخاب کنید."),
});

export const accountingRoleSchema = z.object({
  user_id: z.string().uuid(),
  accounting_role: z.enum(ACCOUNTING_ROLE).nullish(),
});

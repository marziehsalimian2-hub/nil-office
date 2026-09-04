import { z } from "zod";
import { SALES_DOCUMENT_TYPE, SALES_DOCUMENT_ITEM_TYPE, CURRENCY, INVOICE_ROLE } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");
const optIsoDate = isoDate.optional().or(z.literal("").transform(() => undefined));

export const salesDocumentSchema = z.object({
  type: z.enum(SALES_DOCUMENT_TYPE),
  company_id: z.string().uuid("طرف حساب (مشتری) را انتخاب کنید."),
  contract_id: optUuid,
  case_id: optUuid,
  issue_date: optIsoDate,
  due_date: optIsoDate,
  validity_date: optIsoDate,
  currency_code: z.enum(CURRENCY).default("IRR"),
  payment_terms: optText,
  notes: optText,
  customer_legal_name_snapshot: z.string().trim().min(1, "نام حقوقی مشتری الزامی است."),
  customer_english_name_snapshot: optText,
  customer_registration_number_snapshot: optText,
  customer_national_id_snapshot: optText,
  customer_economic_code_snapshot: optText,
  customer_address_snapshot: optText,
  customer_postal_code_snapshot: optText,
  customer_contact_person_snapshot: optText,
  customer_email_snapshot: optText,
  customer_phone_snapshot: optText,
  signatory_id: optUuid,
});

export const salesDocumentItemSchema = z.object({
  item_type: z.enum(SALES_DOCUMENT_ITEM_TYPE).default("SERVICE"),
  description: z.string().trim().min(1, "شرح ردیف الزامی است."),
  unit: z.string().nullish(),
  quantity: z.coerce.number().positive("تعداد باید بزرگ‌تر از صفر باشد."),
  unit_price: z.coerce.number().min(0, "قیمت واحد نمی‌تواند منفی باشد."),
  discount_amount: z.coerce.number().min(0).default(0),
  tax_amount: z.coerce.number().min(0).default(0),
});

export const invoiceRoleSchema = z.object({
  user_id: z.string().uuid(),
  invoice_role: z.enum(INVOICE_ROLE).nullish(),
});

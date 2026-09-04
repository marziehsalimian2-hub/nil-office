import { z } from "zod";
import {
  CRM_COMPANY_STATUS,
  CRM_COMPANY_ROLE,
  CRM_CONTACT_ROLE,
  CRM_OPPORTUNITY_TYPE,
  CRM_OPPORTUNITY_PRIORITY,
  CRM_LOST_REASON,
  CRM_ACTIVITY_TYPE,
  CRM_ROLE,
  CRM_TRADE_FREQUENCY,
  CRM_OPPORTUNITY_PARTY_ROLE,
  CURRENCY,
} from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const optIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.")
  .optional()
  .or(z.literal("").transform(() => undefined));
const optAmount = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));
const optPercent = z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined));

export const companyCrmSchema = z.object({
  crm_status: z.enum(CRM_COMPANY_STATUS),
  owner_user_id: optUuid,
  roles: z.array(z.enum(CRM_COMPANY_ROLE)).default([]),
});

export const contactSchema = z.object({
  company_id: z.string().uuid(),
  first_name: z.string().trim().min(1, "نام الزامی است."),
  last_name: optText,
  job_title: optText,
  department: optText,
  contact_role: z.enum(CRM_CONTACT_ROLE).optional(),
  email: optText,
  phone: optText,
  mobile: optText,
  whatsapp: optText,
  telegram: optText,
  country: optText,
  city: optText,
  is_primary: z.coerce.boolean().default(false),
  is_decision_maker: z.coerce.boolean().default(false),
  is_active: z.coerce.boolean().default(true),
  preferred_language: optText,
  notes: optText,
});

export const opportunitySchema = z.object({
  title: z.string().trim().min(1, "عنوان فرصت الزامی است."),
  company_id: z.string().uuid("انتخاب شرکت الزامی است."),
  primary_contact_id: optUuid,
  case_id: optUuid,
  opportunity_type: z.enum(CRM_OPPORTUNITY_TYPE),
  pipeline_id: z.string().uuid("انتخاب پایپ‌لاین الزامی است."),
  stage_id: z.string().uuid("انتخاب مرحله الزامی است."),
  owner_user_id: optUuid,
  currency_code: z.enum(CURRENCY).default("IRR"),
  estimated_value: optAmount,
  probability: optPercent,
  expected_close_date: optIsoDate,
  source: optText,
  priority: z.enum(CRM_OPPORTUNITY_PRIORITY).default("NORMAL"),
  description: optText,
  internal_notes: optText,
  next_action: optText,
  next_action_date: optIsoDate,
});

export const closeLostSchema = z.object({
  lost_reason: z.enum(CRM_LOST_REASON, { message: "انتخاب دلیل الزامی است." }),
  lost_reason_note: optText,
});

export const activitySchema = z.object({
  company_id: z.string().uuid(),
  contact_id: optUuid,
  opportunity_id: optUuid,
  case_id: optUuid,
  activity_type: z.enum(CRM_ACTIVITY_TYPE),
  activity_date: optIsoDate,
  subject: z.string().trim().min(1, "موضوع الزامی است."),
  summary: optText,
  direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL"]).default("INTERNAL"),
  responsible_user_id: optUuid,
  next_action: optText,
  next_action_date: optIsoDate,
});

export const pipelineStageSchema = z.object({
  pipeline_id: z.string().uuid(),
  name: z.string().trim().min(1, "نام مرحله الزامی است."),
  sort_order: z.coerce.number().default(0),
  is_won: z.coerce.boolean().default(false),
  is_lost: z.coerce.boolean().default(false),
});

export const crmRoleSchema = z.object({
  user_id: z.string().uuid(),
  crm_role: z.enum(CRM_ROLE).nullish(),
});

export const tradeDetailsSchema = z.object({
  opportunity_id: z.string().uuid(),
  product_name: optText,
  grade_specification: optText,
  origin_country: optText,
  destination_country: optText,
  destination_port: optText,
  quantity: optAmount,
  unit: optText,
  packaging: optText,
  incoterm: optText,
  delivery_terms: optText,
  target_price: optAmount,
  offered_price: optAmount,
  currency_code: z.enum(CURRENCY).optional(),
  payment_terms: optText,
  buyer_company_id: optUuid,
  seller_company_id: optUuid,
  buyer_contact_id: optUuid,
  seller_contact_id: optUuid,
  monthly_or_one_time: z.enum(CRM_TRADE_FREQUENCY).optional(),
  specification_notes: optText,
});

export const partySchema = z.object({
  opportunity_id: z.string().uuid(),
  company_id: z.string().uuid("انتخاب شرکت الزامی است."),
  contact_id: optUuid,
  role: z.enum(CRM_OPPORTUNITY_PARTY_ROLE),
  notes: optText,
});

export const quotationSchema = z.object({
  opportunity_id: z.string().uuid(),
  direction: z.enum(["SENT", "RECEIVED"]).default("SENT"),
  buyer_company_id: optUuid,
  seller_company_id: optUuid,
  product_name: optText,
  quantity: optAmount,
  unit: optText,
  unit_price: optAmount,
  currency_code: z.enum(CURRENCY).optional(),
  incoterm: optText,
  origin_country: optText,
  destination_country: optText,
  validity_date: optIsoDate,
  payment_terms: optText,
  notes: optText,
});

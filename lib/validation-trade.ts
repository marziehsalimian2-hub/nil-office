import { z } from "zod";
import { CURRENCY, TRADE_RESPONSE_TYPE, TRADE_DOCUMENT_TYPE, TRADE_DEADLINE_TYPE, TRADE_ROLE } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));

// Datetime-local inputs (`<input type="datetime-local">`) submit
// "YYYY-MM-DDTHH:mm" with no timezone — interpreted as the offer's own
// timezone (default Asia/Tehran) by the server action, never as UTC.
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "تاریخ/ساعت نامعتبر است.");

export const tradeOfferSchema = z.object({
  title: z.string().trim().min(1, "عنوان آفر الزامی است."),
  product_name: z.string().trim().min(1, "نام محصول الزامی است."),
  product_type: optText,
  quantity: z.coerce.number().positive("مقدار باید بزرگ‌تر از صفر باشد."),
  unit: z.string().trim().min(1, "واحد الزامی است."),
  price: z.coerce.number().min(0, "قیمت نمی‌تواند منفی باشد."),
  currency_code: z.enum(CURRENCY).default("USD"),
  price_basis: z.string().trim().min(1, "مبنای قیمت (اینکوترمز) الزامی است."),
  origin: optText,
  delivery_location: optText,
  delivery_terms: optText,
  payment_terms: optText,
  description: optText,
  terms_and_conditions: optText,
  interest_deadline: localDateTime,
  document_deadline: localDateTime,
  timezone: z.string().trim().min(1).default("Asia/Tehran"),
});

export const tradeBuyerAssignSchema = z.object({
  offer_id: z.string().uuid(),
  company_id: z.string().uuid("انتخاب شرکت خریدار الزامی است."),
  expires_in_days: z.coerce.number().int().min(1).max(365).default(30),
});

export const tradeResponseSchema = z.object({
  response_type: z.enum(TRADE_RESPONSE_TYPE),
  explanation: optText,
});

export const tradeDocumentTypeSchema = z.enum(TRADE_DOCUMENT_TYPE);

export const tradeDeadlineExtensionSchema = z.object({
  offer_id: z.string().uuid(),
  deadline_type: z.enum(TRADE_DEADLINE_TYPE),
  new_value: localDateTime,
  reason: optText,
});

export const tradeRoleSchema = z.object({
  user_id: z.string().uuid(),
  trade_role: z.enum(TRADE_ROLE).nullish(),
});

export const tradeOfferListFilterSchema = z.object({
  status: optText,
  product: optText,
  buyer_company_id: optUuid,
  q: optText,
});

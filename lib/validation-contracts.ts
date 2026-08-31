import { z } from "zod";
import { CONTRACT_KIND, CONTRACT_ROLE } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");
const optIsoDate = isoDate.optional().or(z.literal("").transform(() => undefined));
const optAmount = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));

export const contractSchema = z
  .object({
    title: z.string().trim().min(1, "عنوان قرارداد الزامی است."),
    contract_type_id: z.string().uuid("نوع قرارداد را انتخاب کنید."),
    kind: z.enum(CONTRACT_KIND).default("NIL_ISSUED"),
    external_contract_number: optText,
    external_source_note: optText,
    counterparty_company_id: optUuid,
    counterparty_representative_name: optText,
    case_id: optUuid,
    effective_date: optIsoDate,
    expiry_date: optIsoDate,
    signed_date: optIsoDate,
    base_amount: optAmount,
    discount_amount: optAmount,
    tax_amount: optAmount,
    currency_code: z.string().trim().default("IRR"),
    description: optText,
    internal_notes: optText,
    responsible_user: optUuid,
    signatory_id: optUuid,
    signatory_label: optText,
  })
  .refine((d) => d.kind !== "HISTORICAL" || !!d.external_contract_number, {
    message: "برای قرارداد سابق، درج شمارهٔ اصلی قرارداد الزامی است.",
    path: ["external_contract_number"],
  })
  .refine((d) => !d.expiry_date || !d.effective_date || d.expiry_date >= d.effective_date, {
    message: "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.",
    path: ["expiry_date"],
  });

export const contractTypeSchema = z.object({
  code: z.string().trim().min(1, "کد نوع قرارداد الزامی است."),
  name: z.string().trim().min(1, "نام نوع قرارداد الزامی است."),
  is_active: z.coerce.boolean().default(true),
});

export const contractRoleSchema = z.object({
  user_id: z.string().uuid(),
  contract_role: z.enum(CONTRACT_ROLE).nullish(),
});

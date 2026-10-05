import { z } from "zod";
import { CONTRACT_STATUS, CONTRACT_ROLE } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined));
const optMoney = z.coerce.number().min(0).optional();

export const contractSchema = z.object({
  title: z.string().trim().min(1, "عنوان قرارداد الزامی است."),
  contract_type_id: z.string().uuid("نوع قرارداد را انتخاب کنید."),
  party_company_id: optUuid,
  party_contact_name: optText,
  case_id: optUuid,
  contract_date: optDate,
  effective_date: optDate,
  start_date: optDate,
  end_date: optDate,
  currency_code: z.string().trim().default("IRR"),
  base_amount: optMoney,
  tax_amount: optMoney,
  total_amount: optMoney,
  responsible_user_id: optUuid,
  requires_guarantee: z.coerce.boolean().default(false),
  auto_renewal: z.coerce.boolean().default(false),
  description: optText,
  internal_notes: optText,
  is_historical: z.coerce.boolean().default(false),
  original_contract_number: optText,
  original_contract_date: optDate,
  // Only meaningful when is_historical: the contract's real-world status,
  // recorded as-is instead of starting the normal DRAFT lifecycle.
  historical_status: z.enum(CONTRACT_STATUS).optional(),
}).refine(
  (v) => !v.is_historical || !!v.original_contract_number,
  { message: "برای قرارداد تاریخی، درج شمارهٔ اصلی الزامی است.", path: ["original_contract_number"] },
);

export type ContractInput = z.infer<typeof contractSchema>;

export const contractRoleSchema = z.object({
  user_id: z.string().uuid(),
  contract_role: z.enum(CONTRACT_ROLE).nullish(),
});

export const contractTypeSchema = z.object({
  code: z.string().trim().min(1, "کد نوع قرارداد الزامی است.").toUpperCase(),
  label_fa: z.string().trim().min(1, "عنوان نوع قرارداد الزامی است."),
});

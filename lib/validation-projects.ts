import { z } from "zod";
import { PROJECT_TYPE, PM_PRIORITY, PHASE_STATUS, PROJECT_MILESTONE_STATUS, PROJECT_MEMBER_ROLE, PROJECT_ROLE, DELIVERABLE_STATUS } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const optIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.")
  .optional()
  .or(z.literal("").transform(() => undefined));
const optAmount = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));
const CURRENCY = ["IRR", "TOMAN", "USD", "EUR", "AED", "TRY", "CNY"] as const;

export const projectSchema = z.object({
  title: z.string().trim().min(1, "عنوان پروژه الزامی است."),
  description: optText,
  project_type: z.enum(PROJECT_TYPE).default("OTHER"),
  company_id: optUuid,
  case_id: optUuid,
  crm_opportunity_id: optUuid,
  contract_id: optUuid,
  project_manager_id: z.string().uuid("انتخاب مدیر پروژه الزامی است."),
  owner_user_id: optUuid,
  priority: z.enum(PM_PRIORITY).default("NORMAL"),
  planned_start_date: optIsoDate,
  planned_end_date: optIsoDate,
  actual_start_date: optIsoDate,
  actual_end_date: optIsoDate,
  progress_percent: z.coerce.number().min(0).max(100).default(0),
  budget_amount: optAmount,
  budget_currency: z.enum(CURRENCY).optional(),
});

export const phaseSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().trim().min(1, "نام فاز الزامی است."),
  description: optText,
  sequence: z.coerce.number().default(0),
  status: z.enum(PHASE_STATUS).default("NOT_STARTED"),
  planned_start_date: optIsoDate,
  planned_end_date: optIsoDate,
  actual_start_date: optIsoDate,
  actual_end_date: optIsoDate,
  progress_percent: z.coerce.number().min(0).max(100).default(0),
});

export const milestoneSchema = z.object({
  project_id: z.string().uuid(),
  phase_id: optUuid,
  title: z.string().trim().min(1, "عنوان مایلستون الزامی است."),
  description: optText,
  due_date: optIsoDate,
  status: z.enum(PROJECT_MILESTONE_STATUS).default("PLANNED"),
  priority: z.enum(PM_PRIORITY).default("NORMAL"),
  responsible_user_id: optUuid,
});

export const memberSchema = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid("انتخاب کاربر الزامی است."),
  role: z.enum(PROJECT_MEMBER_ROLE).default("MEMBER"),
});

export const projectRoleSchema = z.object({
  user_id: z.string().uuid(),
  project_role: z.enum(PROJECT_ROLE).nullish(),
});

export const deliverableSchema = z.object({
  project_id: z.string().uuid(),
  phase_id: optUuid,
  milestone_id: optUuid,
  title: z.string().trim().min(1, "عنوان تحویل‌دادنی الزامی است."),
  description: optText,
  due_date: optIsoDate,
  status: z.enum(DELIVERABLE_STATUS).default("PLANNED"),
  responsible_user_id: optUuid,
});

export const rejectDeliverableSchema = z.object({
  reason: z.string().trim().min(1, "درج دلیل الزامی است."),
});

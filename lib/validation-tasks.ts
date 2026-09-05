import { z } from "zod";
import { PM_PRIORITY, TASK_STATUS } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const optIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.")
  .optional()
  .or(z.literal("").transform(() => undefined));
const optMinutes = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));

export const taskSchema = z.object({
  title: z.string().trim().min(1, "عنوان کار الزامی است."),
  description: optText,
  project_id: optUuid,
  phase_id: optUuid,
  milestone_id: optUuid,
  company_id: optUuid,
  case_id: optUuid,
  crm_opportunity_id: optUuid,
  contract_id: optUuid,
  assigned_to: optUuid,
  status: z.enum(TASK_STATUS).default("TODO"),
  priority: z.enum(PM_PRIORITY).default("NORMAL"),
  start_date: optIsoDate,
  due_date: optIsoDate,
  estimated_minutes: optMinutes,
  actual_minutes: optMinutes,
  parent_task_id: optUuid,
  blocked_reason: optText,
});

export const dependencySchema = z.object({
  task_id: z.string().uuid(),
  depends_on_task_id: z.string().uuid("انتخاب کار الزامی است."),
});

export const commentSchema = z.object({
  task_id: z.string().uuid(),
  body: z.string().trim().min(1, "متن پیام الزامی است."),
});

export const checklistItemSchema = z.object({
  task_id: z.string().uuid(),
  label: z.string().trim().min(1, "عنوان آیتم الزامی است."),
});

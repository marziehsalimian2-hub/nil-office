import { z } from "zod";
import { HR_ROLE, PERSONNEL_STATUS, PERSONNEL_EMPLOYMENT_TYPE } from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");
const optIsoDate = isoDate.optional().or(z.literal("").transform(() => undefined));
const optHours = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));

export const hrRoleSchema = z.object({
  user_id: z.string().uuid(),
  hr_role: z.enum(HR_ROLE).nullish(),
});

export const onboardPersonnelSchema = z.object({
  first_name: z.string().trim().min(1, "درج نام الزامی است."),
  last_name: z.string().trim().min(1, "درج نام خانوادگی الزامی است."),
  hire_date: isoDate,
  job_title: z.string().trim().min(1, "درج سمت الزامی است."),
  employment_type: z.enum(PERSONNEL_EMPLOYMENT_TYPE),
  department: optText,
  manager_personnel_id: optUuid,
  work_location: optText,
  work_schedule_type: optText,
  standard_monthly_hours: optHours,
  standard_weekly_hours: optHours,
  mobile: optText,
  email: optText,
  address: optText,
  notes: optText,
  profile_id: optUuid,
});

export const personnelEditSchema = z.object({
  first_name: z.string().trim().min(1, "درج نام الزامی است."),
  last_name: z.string().trim().min(1, "درج نام خانوادگی الزامی است."),
  mobile: optText,
  email: optText,
  address: optText,
  work_location: optText,
  notes: optText,
  hire_date: isoDate,
});

export const employmentRecordSchema = z.object({
  employment_type: z.enum(PERSONNEL_EMPLOYMENT_TYPE),
  job_title: z.string().trim().min(1, "درج سمت الزامی است."),
  department: optText,
  manager_personnel_id: optUuid,
  start_date: isoDate,
  work_schedule_type: optText,
  standard_monthly_hours: optHours,
  standard_weekly_hours: optHours,
});

export const personnelStatusChangeSchema = z.object({
  new_status: z.enum(PERSONNEL_STATUS),
  reason: optText,
  effective_date: optIsoDate,
  // rehire-only (TERMINATED -> ACTIVE)
  employment_type: z.enum(PERSONNEL_EMPLOYMENT_TYPE).optional(),
  job_title: optText,
  department: optText,
  manager_personnel_id: optUuid,
  work_schedule_type: optText,
  standard_monthly_hours: optHours,
  standard_weekly_hours: optHours,
});

export const personnelSensitiveSchema = z.object({
  national_id: optText,
  passport_number: optText,
  birth_date: optIsoDate,
  emergency_contact: optText,
});

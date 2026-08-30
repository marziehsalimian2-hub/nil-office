import { z } from "zod";
import {
  CORR_STATUS,
  PRIORITY,
  LANGUAGE,
  CASE_STATUS,
  DOCUMENT_TYPE,
  FOLLOWUP_STATUS,
} from "@/lib/enums";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const outgoingSchema = z.object({
  subject: z.string().trim().min(1, "درج موضوع الزامی است."),
  recipient_company_id: optionalUuid,
  recipient_name: optionalText,
  case_id: optionalUuid,
  signatory_id: optionalUuid,
  language: z.enum(LANGUAGE).default("FA"),
  priority: z.enum(PRIORITY).default("NORMAL"),
  requires_response: z.coerce.boolean().default(false),
  followup_date: optionalDate,
  sent_received_method: optionalText,
  draft_text: optionalText,
  internal_notes: optionalText,
});

export const incomingSchema = z.object({
  subject: z.string().trim().min(1, "درج موضوع الزامی است."),
  external_letter_number: optionalText,
  external_letter_date: optionalDate,
  sent_received_at: optionalDate,
  sender_company_id: optionalUuid,
  recipient_name: optionalText, // contact person
  case_id: optionalUuid,
  assigned_to: optionalUuid,
  requires_response: z.coerce.boolean().default(false),
  followup_date: optionalDate,
  sent_received_method: optionalText,
  internal_notes: optionalText,
});

export const companySchema = z.object({
  legal_name: z.string().trim().min(1, "نام شرکت الزامی است."),
  english_name: optionalText,
  country: optionalText,
  contact_person: optionalText,
  email: optionalText,
  phone: optionalText,
  address: optionalText,
  notes: optionalText,
});

export const caseSchema = z.object({
  title: z.string().trim().min(1, "عنوان پرونده الزامی است."),
  case_type: optionalText,
  company_id: optionalUuid,
  description: optionalText,
  responsible_user: optionalUuid,
  start_date: optionalDate,
  status: z.enum(CASE_STATUS).default("ACTIVE"),
  tags: optionalText,
});

export const documentSchema = z.object({
  title: z.string().trim().min(1, "عنوان سند الزامی است."),
  document_type: z.enum(DOCUMENT_TYPE).default("OTHER"),
  case_id: optionalUuid,
  company_id: optionalUuid,
  document_date: optionalDate,
  received_date: optionalDate,
  version: optionalText,
  description: optionalText,
});

export const followupSchema = z.object({
  title: z.string().trim().min(1, "عنوان پیگیری الزامی است."),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ سررسید الزامی است."),
  assigned_to: optionalUuid,
  correspondence_id: optionalUuid,
  case_id: optionalUuid,
  status: z.enum(FOLLOWUP_STATUS).default("OPEN"),
  note: optionalText,
});

export type OutgoingInput = z.infer<typeof outgoingSchema>;
export type IncomingInput = z.infer<typeof incomingSchema>;
export const ALL_STATUSES = CORR_STATUS;

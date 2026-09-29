import { z } from "zod";
import {
  SERVICE_LEDGER_ROLE,
  CLIENT_SERVICE_STATUS,
  SERVICE_ARRANGEMENT_TYPE,
  SERVICE_ARRANGEMENT_STATUS,
  BILLING_CYCLE,
  SERVICE_ENTRY_STATUS,
  BILLING_STATUS_PHASE1,
  EXPENSE_PAID_BY,
  REPORT_TYPE,
  REPORT_DETAIL_LEVEL,
  ALL_REPORT_SECTIONS,
  REPORT_FIELD,
  REPORT_TEMPLATE_SCOPE,
  REPORT_FAMILY,
} from "@/lib/enums";

const optText = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const optIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.")
  .optional()
  .or(z.literal("").transform(() => undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");
// .min()/.max() only — never .positive()/.gt() (breaks the Assistant's
// entire tool list when reused in an inputSchema, see
// feedback_assistant_zod_schema_gotcha; kept consistent here too even
// though this file isn't itself an Assistant inputSchema).
const optAmount = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));
const CURRENCY = ["IRR", "TOMAN", "USD", "EUR", "AED", "TRY", "CNY"] as const;

export const serviceCategorySchema = z.object({
  code: z.string().trim().min(1, "کد دسته الزامی است."),
  name: z.string().trim().min(1, "نام دسته الزامی است."),
  is_active: z.coerce.boolean().default(true),
});

export const serviceLedgerRoleSchema = z.object({
  user_id: z.string().uuid(),
  service_ledger_role: z.enum(SERVICE_LEDGER_ROLE).nullish(),
});

export const clientServiceFileSchema = z.object({
  company_id: z.string().uuid("انتخاب شرکت الزامی است."),
  status: z.enum(CLIENT_SERVICE_STATUS).default("ACTIVE"),
  relationship_manager: optUuid,
  default_currency: z.enum(CURRENCY).default("IRR"),
  notes: optText,
});

export const serviceArrangementSchema = z
  .object({
    client_service_file_id: z.string().uuid(),
    title: z.string().trim().min(1, "عنوان قرارداد خدمات الزامی است."),
    arrangement_type: z.enum(SERVICE_ARRANGEMENT_TYPE),
    contract_id: optUuid,
    project_id: optUuid,
    currency: z.enum(CURRENCY).default("IRR"),
    fixed_fee: optAmount,
    hourly_rate: optAmount,
    billing_cycle: z.enum(BILLING_CYCLE).optional(),
    included_hours: optAmount,
    included_services_description: optText,
    status: z.enum(SERVICE_ARRANGEMENT_STATUS).default("DRAFT"),
    started_at: optIsoDate,
    ended_at: optIsoDate,
    notes: optText,
  })
  .refine((d) => !d.ended_at || !d.started_at || d.ended_at >= d.started_at, {
    message: "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.",
    path: ["ended_at"],
  });

export const serviceEntrySchema = z.object({
  client_service_file_id: z.string().uuid(),
  service_arrangement_id: optUuid,
  contract_id: optUuid,
  project_id: optUuid,
  task_id: optUuid,
  crm_activity_id: optUuid,
  service_date: isoDate,
  service_category_id: z.string().uuid("دسته‌بندی خدمت را انتخاب کنید."),
  title: z.string().trim().min(1, "عنوان خدمت الزامی است."),
  description: optText,
  performed_by: z.string().uuid("انجام‌دهندهٔ خدمت را انتخاب کنید."),
  status: z.enum(SERVICE_ENTRY_STATUS).default("DRAFT"),
  billing_status: z.enum(BILLING_STATUS_PHASE1).default("NON_BILLABLE"),
  billing_method: optText,
  currency: z.enum(CURRENCY).default("IRR"),
  service_fee: z.coerce.number().min(0).default(0),
  is_billable: z.coerce.boolean().default(true),
  notes: optText,
});

/** duration entered as separate hours/minutes fields in the Quick Add UI, combined server-side. */
export const timeEntrySchema = z.object({
  service_entry_id: z.string().uuid(),
  performed_by: z.string().uuid("انجام‌دهنده را انتخاب کنید."),
  work_date: isoDate,
  duration_minutes: z.coerce.number().min(1, "مدت‌زمان باید حداقل ۱ دقیقه باشد."),
  description: optText,
  billable: z.coerce.boolean().default(true),
  hourly_rate_snapshot: optAmount,
});

export const expenseSchema = z.object({
  service_entry_id: z.string().uuid(),
  expense_date: isoDate,
  category_id: optUuid,
  description: z.string().trim().min(1, "شرح هزینه الزامی است."),
  amount: z.coerce.number().min(0.01, "مبلغ باید بزرگ‌تر از صفر باشد."),
  currency: z.enum(CURRENCY).default("IRR"),
  paid_by: z.enum(EXPENSE_PAID_BY).default("NIL"),
  payment_id: optUuid,
  accounting_reference: optText,
  is_reimbursable: z.coerce.boolean().default(false),
  reimbursable_amount: optAmount,
  billing_status: z.enum(BILLING_STATUS_PHASE1).default("NON_BILLABLE"),
});

export const waiveServiceEntrySchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, "دلیل بخشش الزامی است."),
});

export const waiveExpenseSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, "دلیل بخشش الزامی است."),
});

export const internalCostRateSchema = z.object({
  profile_id: z.string().uuid(),
  hourly_cost_rate: z.coerce.number().min(0, "نرخ باید صفر یا بیشتر باشد."),
  currency: z.enum(CURRENCY).default("IRR"),
});

/** The Quick Add form's single combined submission — a service entry plus its first time entry and (optionally) an expense, in one screen (spec item #10). */
export const quickAddServiceEntrySchema = z.object({
  client_service_file_id: z.string().uuid(),
  service_category_id: z.string().uuid("دسته‌بندی خدمت را انتخاب کنید."),
  title: z.string().trim().min(1, "عنوان خدمت الزامی است."),
  service_date: isoDate,
  duration_minutes: z.coerce.number().min(1, "مدت‌زمان باید حداقل ۱ دقیقه باشد."),
  service_fee: optAmount,
  hourly_rate: optAmount,
  expense_amount: optAmount,
  expense_description: optText,
  expense_is_reimbursable: z.coerce.boolean().default(false),
  currency: z.enum(CURRENCY).default("IRR"),
});

/** Lightweight follow-up edit — adjust a service_entry's fee and/or its first time entry's hourly rate, without re-submitting the whole entry (mirrors bulkMarkServiceEntriesReadyToBill's "thin, targeted action" style). */
export const updateServiceEntryFinancialsSchema = z.object({
  id: z.string().uuid(),
  service_fee: optAmount,
  time_entry_id: optUuid,
  hourly_rate: optAmount,
});

/** Lightweight follow-up edit — mark an already-logged expense as reimbursable (or not), after the fact. */
export const updateExpenseReimbursableSchema = z.object({
  id: z.string().uuid(),
  is_reimbursable: z.coerce.boolean().default(false),
  reimbursable_amount: optAmount,
});

/* ============================ Phase 2 — Billing Batches ==================== */

export const billingBatchSchema = z.object({
  client_service_file_id: z.string().uuid(),
  currency: z.enum(CURRENCY).default("IRR"),
  period_start: optIsoDate,
  period_end: optIsoDate,
});

/** One selected candidate from the batch builder — see the Phase 2 plan's "granular lines, not per-entry rollups" decision: SERVICE_ENTRY/TIME_ENTRY both reference a service_entries id but are two distinct, non-overlapping claims on it. */
export const billingBatchCandidateRefSchema = z.object({
  source_type: z.enum(["SERVICE_ENTRY", "TIME_ENTRY", "EXPENSE"]),
  source_id: z.string().uuid(),
});

export const manualAdjustmentItemSchema = z.object({
  batch_id: z.string().uuid(),
  description: z.string().trim().min(1, "شرح ردیف الزامی است."),
  amount: z.coerce.number().min(0, "مبلغ نمی‌تواند منفی باشد."),
});

/* ============================ Phase 4 — PDF Report Builder ==================== */

/** Sections/fields are submitted as a JSON-stringified array (matches BatchCandidatesCard's own FormData+JSON.stringify convention) — parsed and validated against the REPORT_SECTION/REPORT_FIELD enum here, one shared parser for both schemas below. */
function jsonEnumArray<T extends readonly [string, ...string[]]>(allowed: T, emptyMessage: string) {
  return z.string().transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "داده نامعتبر است." });
      return z.NEVER;
    }
    const result = z.array(z.enum(allowed)).min(1, emptyMessage).safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error.issues[0]?.message ?? "داده نامعتبر است." });
      return z.NEVER;
    }
    return result.data;
  });
}

const reportSectionsField = jsonEnumArray(ALL_REPORT_SECTIONS, "حداقل یک بخش را انتخاب کنید.");
const reportFieldsField = jsonEnumArray(REPORT_FIELD, "حداقل یک ستون را انتخاب کنید.");

/** The Report Builder's Configure step — shared shape for both "Preview" and "Generate" submissions (§54: same configuration, only the persistence step differs between the two actions). */
export const reportBuilderSchema = z.object({
  client_service_file_id: z.string().uuid(),
  report_family: z.enum(REPORT_FAMILY).default("CLIENT"),
  report_type: z.enum(REPORT_TYPE),
  period_start: isoDate,
  period_end: isoDate,
  title: z.string().trim().min(1, "عنوان گزارش الزامی است."),
  introduction: optText,
  final_note: optText,
  custom_notes: optText,
  selected_sections: reportSectionsField,
  selected_fields: reportFieldsField,
  detail_level: z.enum(REPORT_DETAIL_LEVEL),
  show_logo: z.coerce.boolean().default(true),
  show_page_numbers: z.coerce.boolean().default(true),
  template_id: optUuid,
});

export const reportTemplateSchema = z
  .object({
    template_name: z.string().trim().min(1, "نام قالب الزامی است."),
    scope: z.enum(REPORT_TEMPLATE_SCOPE),
    company_id: optUuid,
    report_family: z.enum(REPORT_FAMILY).default("CLIENT"),
    report_type: z.enum(REPORT_TYPE),
    selected_sections: reportSectionsField,
    selected_fields: reportFieldsField,
    detail_level: z.enum(REPORT_DETAIL_LEVEL),
    default_title: optText,
    default_introduction: optText,
    default_final_note: optText,
    default_custom_notes: optText,
    show_logo: z.coerce.boolean().default(true),
    show_page_numbers: z.coerce.boolean().default(true),
  })
  .refine((d) => d.scope === "GLOBAL" || !!d.company_id, {
    message: "برای قالب اختصاصی، انتخاب مشتری الزامی است.",
    path: ["company_id"],
  });

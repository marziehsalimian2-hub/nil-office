import "server-only";
import { z } from "zod";
import { resolvePeriod } from "@/lib/service-ledger/period";
import { REPORT_TYPE_LABEL, type ReportType } from "@/lib/enums";
import { requireClientServiceFile } from "./serviceLedger";
import type { ActionDefinition, ResultCard } from "./types";
import type { ServiceLedgerPeriodSummaryRow } from "@/lib/types/database";

// Only "this_month"/"prev_month"/"quarter"/"year" (a subset of
// lib/service-ledger/period.ts's own PERIOD_PRESETS) — never "custom".
// A custom range needs literal ISO dates the LLM would otherwise have
// to invent (it would have to already know the current Jalali year to
// build e.g. "1405/06/01" for "شهریور" unprompted — exactly the kind of
// date arithmetic lib/assistant/dates.ts's own doc comment warns
// against trusting a model with). Someone needing a specific historical
// range uses the web Report Builder's own date pickers instead.
const periodSchema = z.enum(["this_month", "prev_month", "quarter", "year"]);

function companyCard(company: { id: string; legal_name: string } | null): ResultCard[] {
  return company ? [{ kind: "company", id: company.id, title: company.legal_name, href: `/companies/${company.id}` }] : [];
}

const periodNumbersInput = z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است."), period: periodSchema });

export const getClientServicePeriodNumbers: ActionDefinition<z.infer<typeof periodNumbersInput>> = {
  name: "GET_CLIENT_SERVICE_PERIOD_NUMBERS",
  description:
    "شمارهٔ خدمات، زمان صرف‌شده، حق‌الزحمه، هزینه، مبلغ قابل مطالبه، صورتحساب‌شده و صورتحساب‌نشدهٔ یک مشتری برای یک بازهٔ نام‌دار (این ماه/ماه قبل/فصل جاری/سال جاری). ورودی company_id را باید قبلاً از SEARCH_COMPANY گرفته باشید. period باید یکی از this_month، prev_month، quarter، year باشد — برای بازهٔ دقیق دیگر (مثلاً یک ماه خاص گذشته) کاربر را به گزارش‌سازِ وب ارجاع دهید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: periodNumbersInput,
  handler: async (input, ctx) => {
    const file = await requireClientServiceFile(ctx, input.company_id);
    const { data: company } = await ctx.supabase.from("companies").select("id, legal_name").eq("id", input.company_id).single();
    const resolved = resolvePeriod(input.period);
    const { data } = await ctx.supabase.rpc("get_client_service_period_summary", {
      p_client_service_file_id: file.id,
      p_period_start: resolved.start,
      p_period_end: resolved.end,
    });
    const rows = (data ?? []) as ServiceLedgerPeriodSummaryRow[];
    return { data: { period: resolved.label, rows }, cards: companyCard(company) };
  },
};

export const listClientReportTemplates: ActionDefinition<{ company_id?: string }> = {
  name: "LIST_CLIENT_REPORT_TEMPLATES",
  description:
    "فهرست قالب‌های ذخیره‌شدهٔ گزارش قابل استفاده برای مشتری (سراسری + اختصاصی همین مشتری، در صورت ارسال company_id). فقط قالب‌های گزارش مشتری — قالب‌های گزارش مدیریتی داخلی هرگز از این مسیر نمایش داده نمی‌شوند.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid().optional() }),
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("client_service_report_templates")
      .select("id, template_name, scope, report_type, company_id")
      .eq("is_active", true)
      .eq("report_family", "CLIENT");
    q = input.company_id ? q.or(`scope.eq.GLOBAL,company_id.eq.${input.company_id}`) : q.eq("scope", "GLOBAL");
    const { data } = await q.order("template_name");
    return { data: (data ?? []).map((t) => ({ ...t, report_type_label: REPORT_TYPE_LABEL[t.report_type as ReportType] })) };
  },
};

export const getClientDefaultReportTemplate: ActionDefinition<{ company_id: string }> = {
  name: "GET_CLIENT_DEFAULT_REPORT_TEMPLATE",
  description: "قالب پیش‌فرض گزارش این مشتری، در صورت تنظیم‌بودن. ورودی company_id را از SEARCH_COMPANY بگیرید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است.") }),
  handler: async (input, ctx) => {
    const file = await requireClientServiceFile(ctx, input.company_id);
    const { data: fileRow } = await ctx.supabase.from("client_service_files").select("default_report_template_id").eq("id", file.id).single();
    if (!fileRow?.default_report_template_id) return { data: { note: "برای این مشتری قالب پیش‌فرض گزارش تنظیم نشده است." } };
    const { data: template } = await ctx.supabase
      .from("client_service_report_templates")
      .select("id, template_name, report_type")
      .eq("id", fileRow.default_report_template_id)
      .single();
    return { data: template ?? { note: "قالب پیش‌فرض یافت نشد." } };
  },
};

export const getClientReportHistory: ActionDefinition<{ company_id: string }> = {
  name: "GET_CLIENT_REPORT_HISTORY",
  description: "فهرست آخرین گزارش‌های PDF تولیدشدهٔ این مشتری (فقط گزارش‌های مشتری، نه گزارش‌های مدیریتی داخلی). ورودی company_id را از SEARCH_COMPANY بگیرید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است.") }),
  handler: async (input, ctx) => {
    const file = await requireClientServiceFile(ctx, input.company_id);
    const { data } = await ctx.supabase
      .from("client_service_reports")
      .select("id, title, report_type, period_start, period_end, generated_at")
      .eq("client_service_file_id", file.id)
      .eq("report_family", "CLIENT")
      .order("generated_at", { ascending: false })
      .limit(10);
    return { data: data ?? [] };
  },
};

const prepareReportInput = z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است."), period: periodSchema });

/**
 * The single LLM-visible generation tool — its WRITE_EXECUTORS entry
 * (registered under this SAME name in lib/assistant/confirmation.ts)
 * calls generateClientServiceReportCore, the exact function the web
 * Report Builder's "تولید PDF نهایی" button also calls. §71 informally
 * refers to a second step "GENERATE_CLIENT_SERVICE_REPORT" — that's the
 * executor/Core step, not a second registered tool (mirrors
 * CREATE_SERVICE_ENTRY_DRAFT -> quickAddServiceEntryCore).
 *
 * report_family is hardcoded 'CLIENT' here and NEVER accepted as input —
 * the confidential Internal Management Report (Phase 5) is deliberately
 * never reachable through chat, regardless of the asker's role.
 */
export const prepareClientServiceReport: ActionDefinition<z.infer<typeof prepareReportInput>> = {
  name: "PREPARE_CLIENT_SERVICE_REPORT",
  description:
    "پیشنهاد تولید گزارش PDF دورهٔ برای مشتری با قالب پیش‌فرض او (نه تولید قطعی — فقط پیش‌نمایش برای تأیید کاربر). نیازمند این است که مشتری از قبل قالب پیش‌فرض گزارش داشته باشد (با GET_CLIENT_DEFAULT_REPORT_TEMPLATE بررسی کنید یا بگذارید خطا مسیر را نشان دهد). period باید یکی از this_month، prev_month، quarter، year باشد.",
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  inputSchema: prepareReportInput,
  handler: async (input, ctx) => {
    const file = await requireClientServiceFile(ctx, input.company_id);
    const { data: fileRow } = await ctx.supabase.from("client_service_files").select("default_report_template_id").eq("id", file.id).single();
    if (!fileRow?.default_report_template_id) {
      throw new Error("برای این مشتری قالب پیش‌فرض گزارش تنظیم نشده است. ابتدا از صفحهٔ «گزارش‌ها»ی این مشتری در وب، یک قالب را به‌عنوان پیش‌فرض تنظیم کنید.");
    }
    const { data: template } = await ctx.supabase
      .from("client_service_report_templates")
      .select("*")
      .eq("id", fileRow.default_report_template_id)
      .single();
    if (!template) throw new Error("قالب پیش‌فرض این مشتری دیگر یافت نمی‌شود.");

    const { data: company } = await ctx.supabase.from("companies").select("legal_name").eq("id", input.company_id).single();
    const companyName = company?.legal_name ?? "مشتری";
    const resolved = resolvePeriod(input.period);

    const payload = {
      client_service_file_id: file.id,
      report_family: "CLIENT" as const,
      report_type: template.report_type,
      period_start: resolved.start,
      period_end: resolved.end,
      title: template.default_title || `${REPORT_TYPE_LABEL[template.report_type as ReportType]} — ${companyName}`,
      introduction: template.default_introduction ?? undefined,
      final_note: template.default_final_note ?? undefined,
      custom_notes: template.default_custom_notes ?? undefined,
      selected_sections: template.selected_sections,
      selected_fields: template.selected_fields,
      detail_level: template.detail_level,
      show_logo: template.show_logo,
      show_page_numbers: template.show_page_numbers,
      template_id: template.id,
    };

    const previewText = [`مشتری: ${companyName}`, `بازه: ${resolved.label}`, `قالب: ${template.template_name}`, "نوع: گزارش مشتری"].join("\n");

    return { payload, previewText };
  },
};

export const serviceLedgerReportsActions: ActionDefinition<any>[] = [
  getClientServicePeriodNumbers,
  listClientReportTemplates,
  getClientDefaultReportTemplate,
  getClientReportHistory,
  prepareClientServiceReport,
];

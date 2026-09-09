import "server-only";
import { z } from "zod";
import { getTodaySummary } from "@/lib/dashboard/today";
import { getAttentionItems } from "@/lib/dashboard/attention";
import { getFinancialSummary } from "@/lib/dashboard/financial";
import { getCrmSummary } from "@/lib/dashboard/crm";
import { getProjectsSummary } from "@/lib/dashboard/projects";
import { getContractsSummary } from "@/lib/dashboard/contracts";
import { getInvoiceSummary } from "@/lib/dashboard/invoices";
import type { ActionContext, ActionDefinition } from "./types";

/** Every action here is a thin, read-only wrapper over the Executive Dashboard's own getters (lib/dashboard/*.ts) — same queries, same permission gates, same numbers a human would see on /dashboard. No parallel KPI logic is invented (spec §47/§48). */

async function thresholds(ctx: ActionContext) {
  const { data } = await ctx.supabase.from("app_settings").select("dashboard_contract_expiry_days, dashboard_project_ending_soon_days").eq("id", 1).single();
  return {
    contractExpiryDays: data?.dashboard_contract_expiry_days ?? 30,
    projectEndingSoonDays: data?.dashboard_project_ending_soon_days ?? 14,
  };
}

export const getTodayWork: ActionDefinition<Record<string, never>> = {
  name: "GET_TODAY_WORK",
  description: "امروز چه کارها/پیگیری‌ها/اقدام‌های بعدی CRM/مایلستون‌هایی برای کاربر فعلی سررسید یا عقب‌افتاده است. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  handler: async (_input, ctx) => {
    const data = await getTodaySummary(ctx.supabase, ctx.userId, ctx.profile);
    return { data };
  },
};

export const getAttentionItemsAction: ActionDefinition<Record<string, never>> = {
  name: "GET_ATTENTION_ITEMS",
  description: "لیست موارد نیازمند توجه در کل شرکت (کارهای عقب‌افتاده، پروژه‌های در خطر، فاکتورهای معوق، قراردادهای نزدیک پایان، فرصت‌های راکد و ...) — همان چیزی که مرکز فرمان نشان می‌دهد. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  handler: async (_input, ctx) => {
    const t = await thresholds(ctx);
    const items = await getAttentionItems(ctx.supabase, ctx.profile, t);
    return {
      data: items,
      cards: items.slice(0, 8).map((i) => ({ kind: "attention" as const, id: i.id, title: i.title, subtitle: i.description, href: i.navigation_target })),
    };
  },
};

export const getFinancialSummaryAction: ActionDefinition<Record<string, never>> = {
  name: "GET_FINANCIAL_SUMMARY",
  description: "خلاصه وضعیت مالی نیل: موجودی بانک/صندوق و درآمد/هزینه/نتیجهٔ خالص سال مالی جاری. فقط برای کاربران با دسترسی حسابداری — برای بقیه هیچ داده‌ای برنمی‌گرداند. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  requiredAccess: (p) => p.role === "ADMIN" || p.accounting_role != null,
  handler: async (_input, ctx) => {
    const data = await getFinancialSummary(ctx.supabase, ctx.profile);
    return { data: data ?? { note: "دسترسی مالی ندارید یا داده‌ای موجود نیست." } };
  },
};

export const getReceivablesSummaryAction: ActionDefinition<Record<string, never>> = {
  name: "GET_RECEIVABLES_SUMMARY",
  description: "مطالبات معوق نیل (فاکتورهای صادرشده و هنوز وصول‌نشده)، به تفکیک واحد پول. فقط برای کاربران با دسترسی فاکتور. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  requiredAccess: (p) => p.role === "ADMIN" || p.invoice_role != null,
  handler: async (_input, ctx) => {
    const data = await getInvoiceSummary(ctx.supabase, ctx.profile);
    return { data: data ?? { note: "دسترسی فاکتور ندارید یا داده‌ای موجود نیست." } };
  },
};

export const getCrmSummaryAction: ActionDefinition<Record<string, never>> = {
  name: "GET_CRM_SUMMARY",
  description: "خلاصه وضعیت CRM: فرصت‌های باز، موفق/ازدست‌رفته، بدون فعالیت، اقدام بعدی عقب‌افتاده، ارزش پایپ‌لاین به تفکیک ارز. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  requiredAccess: (p) => p.role === "ADMIN" || p.crm_role != null,
  handler: async (_input, ctx) => {
    const data = await getCrmSummary(ctx.supabase, ctx.profile);
    return { data: data ?? { note: "دسترسی CRM ندارید." } };
  },
};

export const getProjectSummaryAction: ActionDefinition<Record<string, never>> = {
  name: "GET_PROJECT_SUMMARY",
  description: "خلاصه وضعیت پروژه‌ها: تعداد فعال، در معرض خطر، عقب‌افتاده، نزدیک به پایان، کارهای عقب‌افتاده/مسدود. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  requiredAccess: (p) => p.role === "ADMIN" || p.project_role != null,
  handler: async (_input, ctx) => {
    const t = await thresholds(ctx);
    const data = await getProjectsSummary(ctx.supabase, ctx.profile, t.projectEndingSoonDays);
    return { data: data ?? { note: "دسترسی پروژه ندارید." } };
  },
};

export const getContractSummaryAction: ActionDefinition<Record<string, never>> = {
  name: "GET_CONTRACT_SUMMARY",
  description: "خلاصه وضعیت قراردادها: فعال، نزدیک پایان، منقضی‌ولی‌فعال، معلق. بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  requiredAccess: (p) => p.role === "ADMIN" || p.contract_role != null,
  handler: async (_input, ctx) => {
    const t = await thresholds(ctx);
    const data = await getContractsSummary(ctx.supabase, ctx.profile, t.contractExpiryDays);
    return { data: data ?? { note: "دسترسی قرارداد ندارید." } };
  },
};

export const getDailyBrief: ActionDefinition<Record<string, never>> = {
  name: "GET_DAILY_BRIEF",
  description: "گزارش صبحگاهی/روزانهٔ کامل: امروز، نیازمند توجه، پروژه‌ها، CRM، قراردادها، فاکتورها — همه با هم، برای وقتی کاربر می‌گوید «گزارش امروز» یا «امروز چی مهمه». بدون ورودی.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  handler: async (_input, ctx) => {
    const t = await thresholds(ctx);
    const [today, attention, crm, projects, contracts, invoices] = await Promise.all([
      getTodaySummary(ctx.supabase, ctx.userId, ctx.profile),
      getAttentionItems(ctx.supabase, ctx.profile, t),
      getCrmSummary(ctx.supabase, ctx.profile),
      getProjectsSummary(ctx.supabase, ctx.profile, t.projectEndingSoonDays),
      getContractsSummary(ctx.supabase, ctx.profile, t.contractExpiryDays),
      getInvoiceSummary(ctx.supabase, ctx.profile),
    ]);
    return { data: { today, attention, crm, projects, contracts, invoices } };
  },
};

export const dashboardActions: ActionDefinition<any>[] = [
  getTodayWork,
  getAttentionItemsAction,
  getFinancialSummaryAction,
  getReceivablesSummaryAction,
  getCrmSummaryAction,
  getProjectSummaryAction,
  getContractSummaryAction,
  getDailyBrief,
];

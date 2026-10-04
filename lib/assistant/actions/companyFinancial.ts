import "server-only";
import { z } from "zod";
import { canViewCompanyFinancials } from "./access";
import type { ActionDefinition, ResultCard } from "./types";

type CompanyBalance = {
  company: { id: string; name: string };
  currencies: { currency: string; received: string; paid: string; outstanding_invoices: string }[];
};

/**
 * «مانده حساب شرکت» (spec §26/§27): per-currency RECEIVED / PAID / OUTSTANDING-INVOICES for one company, from
 * the existing get_company_financial_summary (0105) via assistant_company_balance (0134). Rules this action
 * enforces by construction:
 *   - amounts are exact decimal TEXT straight from the database; the model never calculates or re-adds them;
 *   - currencies are NEVER summed (one row per currency);
 *   - only POSTED receipts/payments count, and "outstanding" is the unsettled part of ISSUED invoices —
 *     draft / unposted money is not a balance (spec: Draft != Posted != Settled);
 *   - the gate is ADMIN or an accounting / invoice / contract role (the same people who see the company's
 *     financial tab on the web); the SQL function re-checks it.
 */
export const getCompanyFinancialSummary: ActionDefinition<{ company_id: string }> = {
  name: "GET_COMPANY_FINANCIAL_SUMMARY",
  description:
    "مانده/وضعیت مالی یک شرکت: مبلغ دریافت‌شده، پرداخت‌شده و مانده فاکتورهای صادرشده — جدا به تفکیک هر واحد پول (هرگز واحدهای مختلف را جمع نزن و هیچ مبلغی را خودت محاسبه یا گرد نکن). فقط اسناد «قطعی‌شده» (Posted) حساب می‌شوند، نه پیش‌نویس. company_id را باید قبلاً از SEARCH_COMPANY گرفته باشی؛ اگر چند شرکت با نام مشابه پیدا شد، از کاربر بپرس کدام.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  requiredAccess: canViewCompanyFinancials,
  inputSchema: z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است.") }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.rpc("assistant_company_balance", { p_profile_id: ctx.userId, p_company_id: input.company_id });
    if (error) {
      if (error.message.includes("NOT_FOUND")) return { data: { note: "شرکتی با این شناسه پیدا نشد." } };
      if (error.message.includes("NOT_AUTHORIZED")) throw new Error("به اطلاعات مالی شرکت‌ها دسترسی ندارید.");
      console.error("[assistant] assistant_company_balance failed", error.message);
      throw new Error("دریافت وضعیت مالی شرکت ناموفق بود.");
    }
    const result = data as CompanyBalance;
    const cards: ResultCard[] = [{ kind: "company", id: result.company.id, title: result.company.name, href: `/companies/${result.company.id}` }];
    if (result.currencies.length === 0) {
      return { data: { company: result.company.name, note: "برای این شرکت هنوز دریافت/پرداخت قطعی‌شده یا فاکتور صادرشدهٔ باز ثبت نشده است." }, cards };
    }
    return {
      data: {
        company: result.company.name,
        basis: "فقط اسناد قطعی‌شده؛ مانده = بخش تسویه‌نشدهٔ فاکتورهای صادرشده",
        per_currency: result.currencies,
      },
      cards,
    };
  },
};

export const companyFinancialActions: ActionDefinition<any>[] = [getCompanyFinancialSummary];

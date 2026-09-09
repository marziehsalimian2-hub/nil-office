import "server-only";
import { z } from "zod";
import type { ActionContext, ActionDefinition, ResultCard } from "./types";

/**
 * GET_COMPANY_360 — the one genuinely new composition in the Action
 * Registry (everything else is a thin wrapper). Pulls one section per
 * module in parallel, exactly like the Executive Dashboard's own
 * sections: a section is simply ABSENT from the result when the caller
 * lacks that module's access, never fetched-then-hidden (spec §58's
 * "hiding a card is not enough" — same doctrine as
 * lib/dashboard/financial.ts).
 */
export const getCompany360: ActionDefinition<{ company_id: string }> = {
  name: "GET_COMPANY_360",
  description: "نمای ۳۶۰ درجهٔ یک شرکت: اطلاعات پایه، فرصت‌های CRM باز، قراردادها، پروژه‌ها، فاکتورها و مطالبات، مکاتبات و پیگیری‌های اخیر. ورودی company_id را باید قبلاً از SEARCH_COMPANY گرفته باشید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ company_id: z.string().uuid("شناسهٔ شرکت نامعتبر است.") }),
  handler: async (input, ctx) => {
    const { supabase, profile } = ctx;
    const hasCrm = profile.role === "ADMIN" || profile.crm_role != null;
    const hasContract = profile.role === "ADMIN" || profile.contract_role != null;
    const hasProject = profile.role === "ADMIN" || profile.project_role != null;
    const hasInvoice = profile.role === "ADMIN" || profile.invoice_role != null;

    const [{ data: company }, opportunities, contracts, projects, invoices, correspondence, followups] = await Promise.all([
      supabase.from("companies").select("id, legal_name, english_name, country, contact_person, email, phone").eq("id", input.company_id).single(),
      hasCrm
        ? supabase.from("crm_opportunities").select("id, opportunity_number, title, estimated_value, currency_code").eq("company_id", input.company_id).is("won_at", null).is("lost_at", null)
        : Promise.resolve({ data: null }),
      hasContract
        ? supabase.from("contracts").select("id, title, display_number, status").eq("counterparty_company_id", input.company_id)
        : Promise.resolve({ data: null }),
      hasProject
        ? supabase.from("projects").select("id, title, display_number, status").eq("company_id", input.company_id)
        : Promise.resolve({ data: null }),
      hasInvoice
        ? supabase.from("sales_documents").select("id, display_number, type, status, total_amount, currency_code").eq("company_id", input.company_id).order("created_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: null }),
      supabase.from("correspondence").select("id, display_number, subject, status, created_at").or(`recipient_company_id.eq.${input.company_id}`).order("created_at", { ascending: false }).limit(5),
      supabase.from("followups").select("id, title, due_date, status").eq("company_id", input.company_id).eq("status", "OPEN").order("due_date"),
    ]);

    if (!company) return { data: { note: "شرکتی با این شناسه پیدا نشد." } };

    const cards: ResultCard[] = [{ kind: "company", id: company.id, title: company.legal_name, href: `/companies/${company.id}` }];

    return {
      data: {
        company,
        openOpportunities: opportunities.data ?? (hasCrm ? [] : "دسترسی CRM ندارید"),
        contracts: contracts.data ?? (hasContract ? [] : "دسترسی قرارداد ندارید"),
        projects: projects.data ?? (hasProject ? [] : "دسترسی پروژه ندارید"),
        recentInvoices: invoices.data ?? (hasInvoice ? [] : "دسترسی فاکتور ندارید"),
        recentCorrespondence: correspondence.data ?? [],
        openFollowups: followups.data ?? [],
      },
      cards,
    };
  },
};

export const companyActions: ActionDefinition<any>[] = [getCompany360];

import "server-only";
import { z } from "zod";
import type { ActionContext, ActionDefinition, ResultCard } from "./types";

type SearchAllRow = { entity_type: string; id: string; title: string; subtitle: string | null; extra: string | null; created_at: string };

/**
 * search_all() (0052_project_task_functions.sql) is this codebase's own
 * cross-module search precedent — a plain `stable sql` function, not
 * SECURITY DEFINER, so it already returns only rows the caller's own
 * RLS lets them see. Every SEARCH_* action below just calls it and
 * filters to one entity_type, rather than writing a parallel query per
 * entity (spec §15's "search must use structured services, not raw SQL"
 * — this literally is the existing structured service).
 */
async function searchAll(ctx: ActionContext, q: string): Promise<SearchAllRow[]> {
  const { data } = await ctx.supabase.rpc("search_all", { p_q: q });
  return (data ?? []) as SearchAllRow[];
}

function makeSearchAction(opts: {
  name: string;
  description: string;
  entityType: string;
  cardKind: ResultCard["kind"];
  href: (id: string) => string;
  requiredAccess?: (p: import("@/lib/types/database").Profile) => boolean;
}): ActionDefinition<{ query: string }> {
  return {
    name: opts.name,
    description: opts.description,
    riskLevel: "LOW",
    requiresConfirmation: false,
    inputSchema: z.object({ query: z.string().trim().min(1, "عبارت جست‌وجو الزامی است.") }),
    requiredAccess: opts.requiredAccess,
    handler: async (input, ctx) => {
      const rows = (await searchAll(ctx, input.query)).filter((r) => r.entity_type === opts.entityType).slice(0, 15);
      const cards: ResultCard[] = rows.map((r) => ({ kind: opts.cardKind, id: r.id, title: r.title, subtitle: r.subtitle ?? undefined, href: opts.href(r.id) }));
      return { data: rows, cards };
    },
  };
}

export const searchCompany = makeSearchAction({
  name: "SEARCH_COMPANY",
  description: "جست‌وجوی شرکت‌ها بر اساس نام (فارسی یا انگلیسی).",
  entityType: "company",
  cardKind: "company",
  href: (id) => `/companies/${id}`,
});

export const searchOpportunity = makeSearchAction({
  name: "SEARCH_OPPORTUNITY",
  description: "جست‌وجوی فرصت‌های تجاری/فروش (CRM) بر اساس عنوان یا شمارهٔ فرصت.",
  entityType: "opportunity",
  cardKind: "opportunity",
  href: (id) => `/opportunities/${id}`,
  requiredAccess: (p) => p.role === "ADMIN" || p.crm_role != null,
});

export const searchContract = makeSearchAction({
  name: "SEARCH_CONTRACT",
  description: "جست‌وجوی قراردادها بر اساس عنوان یا شمارهٔ قرارداد.",
  entityType: "contract",
  cardKind: "contract",
  href: (id) => `/contracts/${id}`,
  requiredAccess: (p) => p.role === "ADMIN" || p.contract_role != null,
});

export const searchInvoices = makeSearchAction({
  name: "SEARCH_INVOICES",
  description: "جست‌وجوی فاکتور/پیش‌فاکتور بر اساس شماره یا نام مشتری.",
  entityType: "sales_document",
  cardKind: "invoice",
  href: (id) => `/invoices/${id}`,
  requiredAccess: (p) => p.role === "ADMIN" || p.invoice_role != null,
});

export const searchProject = makeSearchAction({
  name: "SEARCH_PROJECT",
  description: "جست‌وجوی پروژه‌ها بر اساس عنوان یا شماره.",
  entityType: "project",
  cardKind: "project",
  href: (id) => `/projects/${id}`,
  requiredAccess: (p) => p.role === "ADMIN" || p.project_role != null,
});

export const searchCorrespondence = makeSearchAction({
  name: "SEARCH_CORRESPONDENCE",
  description: "جست‌وجوی نامه‌های صادره/وارده بر اساس موضوع یا شماره.",
  entityType: "correspondence",
  cardKind: "correspondence",
  href: (id) => `/correspondence/${id}`,
});

export const searchDocuments = makeSearchAction({
  name: "SEARCH_DOCUMENTS",
  description: "جست‌وجوی اسناد بایگانی‌شده بر اساس عنوان.",
  entityType: "document",
  cardKind: "correspondence",
  href: (id) => `/documents/${id}`,
});

export const searchTasks = makeSearchAction({
  name: "SEARCH_TASKS",
  description: "جست‌وجوی کارها بر اساس عنوان.",
  entityType: "task",
  cardKind: "task",
  href: (id) => `/tasks/${id}`,
});

export const searchActions: ActionDefinition<any>[] = [
  searchCompany,
  searchOpportunity,
  searchContract,
  searchInvoices,
  searchProject,
  searchCorrespondence,
  searchDocuments,
  searchTasks,
];

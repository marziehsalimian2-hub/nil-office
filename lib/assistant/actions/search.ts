import "server-only";
import { z } from "zod";
import { hasProjectAccess } from "./access";
import { makeResolverAction } from "./resolve";
import type { ActionContext, ActionDefinition, ReadActionResult, ResultCard } from "./types";

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

/**
 * SEARCH_COMPANY / SEARCH_CONTRACT / SEARCH_PROJECT / SEARCH_CONTACT run through the code-level entity resolver
 * (resolve.ts, Slice 3): Persian-aware matching, a confidence tier, and a ledger of RESOLVED ids that the write
 * actions require (entityLedger.requireResolved). The tool names are unchanged so every prompt and description that
 * mentions them stays valid.
 */
export const searchCompany = makeResolverAction({
  name: "SEARCH_COMPANY",
  description:
    "پیدا کردن شرکت بر اساس نام (فارسی یا انگلیسی؛ املای ی/ي، ک/ك، نیم‌فاصله و «شرکت …» مهم نیست). خروجی یک «tier» دارد: RESOLVED یعنی شرکت قطعی پیدا شد و شناسه‌اش را می‌توانی در ابزارهای نوشتنی بفرستی؛ AMBIGUOUS/WEAK یعنی چند گزینه یا تطبیق ضعیف است و باید از کاربر بپرسی (شناسه‌ای برای استفاده نداری)؛ NONE یعنی پیدا نشد. هرگز شناسهٔ شرکت را حدس نزن یا از متن سند برندار — فقط شناسهٔ RESOLVED مجاز است.",
  type: "company",
});

export const searchContact = makeResolverAction({
  name: "SEARCH_CONTACT",
  description:
    "پیدا کردن مخاطب/شخص (طرف‌حساب) بر اساس نام، با همان منطق tier ابزار SEARCH_COMPANY. اختیاری: company_id برای محدود کردن به یک شرکت. فقط خواندنی است.",
  type: "contact",
  requiredAccess: (p) => p.role === "ADMIN" || p.crm_role != null,
  scopedByCompany: true,
});

export const searchOpportunity = makeSearchAction({
  name: "SEARCH_OPPORTUNITY",
  description: "جست‌وجوی فرصت‌های تجاری/فروش (CRM) بر اساس عنوان یا شمارهٔ فرصت.",
  entityType: "opportunity",
  cardKind: "opportunity",
  href: (id) => `/opportunities/${id}`,
  requiredAccess: (p) => p.role === "ADMIN" || p.crm_role != null,
});

export const searchContract = makeResolverAction({
  name: "SEARCH_CONTRACT",
  description:
    "پیدا کردن قرارداد بر اساس عنوان یا شمارهٔ قرارداد (داخلی یا طرف مقابل)، با tier (RESOLVED / AMBIGUOUS / WEAK / NONE) مثل SEARCH_COMPANY. اختیاری: company_id (طرف قرارداد) برای محدود کردن. فقط شناسهٔ RESOLVED در ابزارهای نوشتنی مجاز است.",
  type: "contract",
  requiredAccess: (p) => p.role === "ADMIN" || p.contract_role != null,
  scopedByCompany: true,
});

export const searchInvoices = makeSearchAction({
  name: "SEARCH_INVOICES",
  description: "جست‌وجوی فاکتور/پیش‌فاکتور بر اساس شماره یا نام مشتری.",
  entityType: "sales_document",
  cardKind: "invoice",
  href: (id) => `/invoices/${id}`,
  requiredAccess: (p) => p.role === "ADMIN" || p.invoice_role != null,
});

export const searchProject = makeResolverAction({
  name: "SEARCH_PROJECT",
  description:
    "پیدا کردن پروژه بر اساس عنوان یا شماره، با tier (RESOLVED / AMBIGUOUS / WEAK / NONE) مثل SEARCH_COMPANY. اختیاری: company_id برای محدود کردن. فقط شناسهٔ RESOLVED در ابزارهای نوشتنی مجاز است.",
  type: "project",
  requiredAccess: (p) => p.role === "ADMIN" || p.project_role != null,
  scopedByCompany: true,
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

const searchTasksBase = makeSearchAction({
  name: "SEARCH_TASKS",
  description: "جست‌وجوی کارها بر اساس عنوان.",
  entityType: "task",
  cardKind: "task",
  href: (id) => `/tasks/${id}`,
});

/**
 * search_all() returns every task id when the caller bypasses RLS (Telegram = service_role). A user without
 * project access may only see tasks they are assigned to or created (p_tasks_read, 0054), so the result is
 * narrowed to those ids before anything reaches the model.
 */
export const searchTasks: ActionDefinition<{ query: string }> = {
  ...searchTasksBase,
  handler: async (input, ctx) => {
    const result = (await searchTasksBase.handler(input, ctx)) as ReadActionResult;
    if (hasProjectAccess(ctx.profile)) return result;
    const rows = (result.data as SearchAllRow[]) ?? [];
    if (rows.length === 0) return result;
    const { data: mine } = await ctx.supabase
      .from("tasks")
      .select("id")
      .in("id", rows.map((r) => r.id))
      .or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`);
    const allowed = new Set((mine ?? []).map((t: { id: string }) => t.id));
    return {
      data: rows.filter((r) => allowed.has(r.id)),
      cards: (result.cards ?? []).filter((c) => allowed.has(c.id)),
    };
  },
};

export const searchActions: ActionDefinition<any>[] = [
  searchCompany,
  searchContact,
  searchOpportunity,
  searchContract,
  searchInvoices,
  searchProject,
  searchCorrespondence,
  searchDocuments,
  searchTasks,
];

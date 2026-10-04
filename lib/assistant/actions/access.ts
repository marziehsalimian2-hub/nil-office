import type { Profile } from "@/lib/types/database";
import type { ActionDefinition } from "./types";

/**
 * Permission predicates shared by the Action Registry (spec §41). Over Telegram every query runs as
 * service_role (RLS bypassed — see telegram/session.ts), so `requiredAccess` is the ONLY gate and must be
 * at least as strict as the web's own RLS for the same data. Each predicate mirrors a SQL helper:
 *   hasServiceLedgerAccess  <-> has_service_ledger_access()  (0082)
 *   hasProjectAccess        <-> has_project_access()         (0054 — tasks are visible to project users OR their own assignee/creator)
 *   canApproveInvoice       <-> can_approve_invoice()        (0031)
 *   canCreateInvoice        <-> invoice_role in CREATE/APPROVE/ADMIN
 *   hasAccountingAccess     <-> has_accounting_access()      (0008 — any accounting_role)
 *   canCreateAccounting     <-> can_create_accounting()      (0008 — accounting_role CREATE/POST/ADMIN; creates receipt/payment DRAFTS)
 * Pure (type-only imports) so access.test.ts needs no mocks.
 */
export const hasServiceLedgerAccess = (p: Profile) => p.role === "ADMIN" || p.service_ledger_role != null;
export const hasProjectAccess = (p: Profile) => p.role === "ADMIN" || p.project_role != null;
export const canCreateInvoice = (p: Profile) => p.role === "ADMIN" || p.invoice_role === "CREATE" || p.invoice_role === "APPROVE" || p.invoice_role === "ADMIN";
export const canApproveInvoice = (p: Profile) => p.role === "ADMIN" || p.invoice_role === "APPROVE" || p.invoice_role === "ADMIN";
export const hasAccountingAccess = (p: Profile) => p.role === "ADMIN" || p.accounting_role != null;
export const canCreateAccounting = (p: Profile) =>
  p.role === "ADMIN" || p.accounting_role === "CREATE" || p.accounting_role === "POST" || p.accounting_role === "ADMIN";
export const canViewCompanyFinancials = (p: Profile) =>
  p.role === "ADMIN" || p.accounting_role != null || p.invoice_role != null || p.contract_role != null;

/** Applies a gate to every action of a family that has none of its own. */
export function withAccess(actions: ActionDefinition<any>[], gate: (p: Profile) => boolean): ActionDefinition<any>[] {
  return actions.map((a) => (a.requiredAccess ? a : { ...a, requiredAccess: gate }));
}

/** Plain-text rendering of the stored (sanitised) letter HTML for chat previews. */
export function htmlToPlainText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

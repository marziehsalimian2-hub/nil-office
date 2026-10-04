import "server-only";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmTool } from "@/lib/assistant/llm";
import type { ActionDefinition } from "./types";
import { dashboardActions } from "./dashboard";
import { searchActions } from "./search";
import { companyActions } from "./company";
import { crmActions } from "./crm";
import { projectActions } from "./project";
import { contractActions } from "./contract";
import { correspondenceActions } from "./correspondence";
import { documentActions } from "./document";
import { taskActions } from "./task";
import { followupActions } from "./followup";
import { tradeActions } from "./trade";
import { chequeActions } from "./cheque";
import { invoiceActions } from "./invoice";
import { serviceLedgerActions } from "./serviceLedger";
import { serviceLedgerReportsActions } from "./serviceLedgerReports";
import { payslipActions } from "./payslip";
import { companyFinancialActions } from "./companyFinancial";
import { cashActions } from "./cash";

/**
 * The complete Action Registry — the ONLY set of operations the LLM can
 * ever request (spec §4). CRITICAL is never wired up: no accounting
 * posting, no permission/user management — those actions simply don't
 * exist here, so there is no tool definition the model could ever call
 * for them, not even one guarded by a confirmation the model might talk
 * its way past. Cheque Management's own HIGH/CRITICAL-tier operations
 * (issue_cheque, clear_cheque, record_cheque_print, void_cheque, ...)
 * follow the same rule — chequeActions below exposes only read actions
 * plus two MEDIUM write-proposals (draft creation, print preparation).
 *
 * The deliberate HIGH-risk exceptions (a widening the user explicitly
 * asked for, not an oversight): FINALIZE_LETTER, ISSUE_SALES_DOCUMENT and
 * REGISTER_INCOMING_LETTER each result in an official, irreversible
 * number but ARE wired up, because they go through the Confirmation
 * Engine (preview + explicit-button confirm — never a bare «باشه» —
 * + payload HMAC + permission revalidation at execute + idempotent
 * claim). Since the Internal Assistant v1.0 hardening the outgoing
 * letter / invoice are TWO steps: CREATE_LETTER_DRAFT and
 * CREATE_INVOICE_DRAFT are MEDIUM and only save a numberless draft; the
 * official number is the separate FINALIZE_LETTER / ISSUE_SALES_DOCUMENT
 * confirmation. The model can propose, but only an explicit human tap on
 * "تأیید" executes anything.
 *
 * Every action must declare its permission posture (registry.test.ts):
 * either a `requiredAccess` gate or an explicit entry in the test's
 * ANY_ACTIVE_USER allowlist with the RLS policy that justifies it —
 * Telegram runs as service_role, so a missing gate means no gate at all.
 *
 * Client Service Ledger Phase 2 (Billing Integration) deliberately does
 * NOT add a billing-batch-creation or batch-conversion action here —
 * converting a batch into a real sales_document is a bigger escalation
 * than even CREATE_INVOICE_DRAFT (it also mutates a whole set of
 * service-ledger rows atomically). serviceLedgerActions below stays
 * read-only for anything billing-related (GET_UNBILLED_WORK etc.) plus
 * the existing Phase 1 entry/time/expense drafts — this is a permanent
 * boundary, not a placeholder for later.
 */
export const ACTION_REGISTRY: ActionDefinition<any>[] = [
  ...dashboardActions,
  ...searchActions,
  ...companyActions,
  ...crmActions,
  ...projectActions,
  ...contractActions,
  ...correspondenceActions,
  ...documentActions,
  ...taskActions,
  ...followupActions,
  ...tradeActions,
  ...chequeActions,
  ...invoiceActions,
  ...serviceLedgerActions,
  ...serviceLedgerReportsActions,
  ...payslipActions,
  ...companyFinancialActions,
  ...cashActions,
];

const registryByName = new Map(ACTION_REGISTRY.map((a) => [a.name, a]));

export function getAction(name: string): ActionDefinition<any> | undefined {
  return registryByName.get(name);
}

/** Converts every registered action into the tool definitions passed to the LLM this turn — the model only ever sees name/description/input schema, never implementation. */
export function buildLlmTools(): LlmTool[] {
  return ACTION_REGISTRY.map((a) => ({
    name: a.name,
    description: a.description,
    inputSchema: zodToJsonSchema(a.inputSchema, { target: "openApi3" }) as Record<string, unknown>,
  }));
}

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
 * The one deliberate exception (NIL Assistant Multimodal v2.0, spec
 * §71/§72 — a widening the user explicitly asked for, not an
 * oversight): CREATE_LETTER_DRAFT and CREATE_INVOICE_DRAFT are HIGH
 * risk (each results in an official, irreversible number) but ARE
 * wired up, because they go through the exact same Confirmation
 * Engine preview+explicit-confirm+idempotent-claim mechanism every
 * MEDIUM action already uses — the model can propose, but only an
 * explicit human tap on "تأیید" executes anything, same guarantee as
 * every other write action here.
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

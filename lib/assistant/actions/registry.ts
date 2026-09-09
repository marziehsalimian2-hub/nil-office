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

/**
 * The complete Action Registry — the ONLY set of operations the LLM can
 * ever request (spec §4). Nothing HIGH/CRITICAL is wired up in v1 (spec
 * §6): no accounting posting, no contract activation, no invoice
 * finalization, no official letter numbering, no Trade Portal publish/
 * buyer-issuance/deadline-extension, no permission/user management —
 * those actions simply don't exist here, so there is no tool definition
 * the model could ever call for them, not even one guarded by a
 * confirmation the model might talk its way past.
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

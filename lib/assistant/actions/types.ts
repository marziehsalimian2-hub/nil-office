import "server-only";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ActionContext = {
  /** The caller's own authenticated, RLS-bound client — never service-role. Every read/write an action performs goes through this. */
  supabase: SupabaseClient;
  userId: string;
  profile: Profile;
};

/** The small structured "card" shape a read action can attach to its answer (spec §29/§30 — always traceable to a real record). */
export type ResultCard = {
  kind: "task" | "project" | "contract" | "invoice" | "company" | "opportunity" | "attention" | "followup" | "correspondence" | "trade_offer";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type ReadActionResult = { data: unknown; cards?: ResultCard[] };

/**
 * What a MEDIUM (write) action's handler returns: NOT the write itself —
 * a validated, fully-resolved proposal (relative dates already turned
 * into absolute ISO dates against the server clock, entity ids already
 * resolved) plus the human-readable preview text shown before
 * confirmation. The actual insert only ever happens later, from
 * lib/assistant/confirmation.ts's executor map, when a human confirms
 * (plan decision #5) — never from this handler.
 */
export type WriteProposal = { payload: Record<string, unknown>; previewText: string };

/**
 * `requiresConfirmation` intentionally stays a plain runtime boolean
 * rather than a discriminant TypeScript narrows the handler's return
 * type on — a discriminated-union version of this type doesn't survive
 * being erased into one heterogeneous `ActionDefinition[]` registry
 * (each action has its own concrete TInput; the array needs them all to
 * unify). Each action module below is still fully type-checked against
 * its own specific input/output shape at its own definition site; only
 * the shared registry array itself treats every handler as returning
 * `ReadActionResult | WriteProposal`, and orchestrator.ts branches on
 * `requiresConfirmation` at runtime to know which one it actually got.
 */
export type ActionDefinition<TInput = never> = {
  name: string;
  /** Shown to the LLM as the tool description — keep it precise, this is what the model reasons from. */
  description: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  inputSchema: z.ZodType<TInput>;
  /** undefined = any active user (e.g. LIST_MY_TASKS); otherwise checked against the caller's profile before the handler ever runs. */
  requiredAccess?: (profile: Profile) => boolean;
  handler: (input: TInput, ctx: ActionContext) => Promise<ReadActionResult | WriteProposal>;
};

/** Each requiredAccess closure decides its own ADMIN bypass itself (matching the `profile.role === "ADMIN" || profile.x_role != null` shape already used in every lib/dashboard/*.ts getter) — this helper just runs it. */
export function hasAccess(profile: Profile, requiredAccess?: (profile: Profile) => boolean): boolean {
  return !requiredAccess || requiredAccess(profile);
}

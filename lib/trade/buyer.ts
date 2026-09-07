import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { hashToken } from "@/lib/trade/token";
import type { TradeBuyerViewResult } from "@/lib/types/database";

/**
 * The full set of UI states the Buyer Portal page can render (spec §75's
 * 8 states, plus OFFER_NOT_PUBLISHED for the edge case where an admin
 * generated a link before publishing — not a state the manual flow
 * produces, but one the DB layer can return, so the UI must handle it).
 */
export type TradeBuyerUiState =
  | "ACTIVE"
  | "INTEREST_DEADLINE_EXPIRED"
  | "DOCUMENT_DEADLINE_EXPIRED"
  | "OFFER_CLOSED"
  | "OFFER_CANCELLED"
  | "ACCESS_EXPIRED"
  | "ACCESS_REVOKED"
  | "OFFER_NOT_PUBLISHED"
  | "INVALID_LINK";

export type TradeBuyerView =
  | { uiState: "INVALID_LINK" | "ACCESS_REVOKED" | "ACCESS_EXPIRED" | "OFFER_NOT_PUBLISHED" }
  | {
      uiState: Exclude<TradeBuyerUiState, "INVALID_LINK" | "ACCESS_REVOKED" | "ACCESS_EXPIRED" | "OFFER_NOT_PUBLISHED">;
      offer: Extract<TradeBuyerViewResult, { ok: true }>["offer"];
      assignment: Extract<TradeBuyerViewResult, { ok: true }>["assignment"];
    };

/**
 * The ONLY entry point the buyer-facing route uses to read offer data.
 * Hashes the raw token, calls trade_get_buyer_view() via the service-
 * role client (bypasses RLS by design — the function itself re-derives
 * every authorization check from the token hash, never trusting a prior
 * check), and projects the DB's coarse `state` + deadline booleans into
 * the fine-grained UI state the page renders against.
 */
export async function getTradeBuyerView(rawToken: string): Promise<TradeBuyerView> {
  const tokenHash = hashToken(rawToken);
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("trade_get_buyer_view", { p_token_hash: tokenHash });
  if (error || !data) {
    console.error("[getTradeBuyerView] RPC failed", error);
    return { uiState: "INVALID_LINK" };
  }

  const result = data as TradeBuyerViewResult;
  if (!result.ok) {
    return { uiState: result.error };
  }

  if (result.state === "CLOSED") return { uiState: "OFFER_CLOSED", offer: result.offer, assignment: result.assignment };
  if (result.state === "CANCELLED") return { uiState: "OFFER_CANCELLED", offer: result.offer, assignment: result.assignment };
  if (result.state === "EXPIRED") return { uiState: "DOCUMENT_DEADLINE_EXPIRED", offer: result.offer, assignment: result.assignment };

  // state === "ACTIVE"
  if (!result.offer.interest_open) {
    return { uiState: "INTEREST_DEADLINE_EXPIRED", offer: result.offer, assignment: result.assignment };
  }
  return { uiState: "ACTIVE", offer: result.offer, assignment: result.assignment };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Telegram retries a webhook delivery whenever it doesn't see a fast
 * 200 — this is the FIRST thing the webhook route does, before any
 * auth/session work, so a retried update never runs the assistant twice
 * (spec §30). A unique-constraint violation on (channel, external_
 * update_id) means "already seen" -> the caller returns 200 immediately
 * and does nothing else. Service-role client — no session exists yet.
 */
export type ClaimResult = "new" | "duplicate" | "error";

/**
 * "error" (the claim row could not be written for any reason OTHER than a duplicate) is deliberately
 * distinct from "duplicate": the webhook answers 500 for it so Telegram retries the update, instead of
 * silently dropping a message that was never processed.
 */
export async function claimUpdateOnce(serviceClient: SupabaseClient, channel: "TELEGRAM", externalUpdateId: string | number): Promise<ClaimResult> {
  const { error } = await serviceClient
    .from("assistant_channel_updates")
    .insert({ channel, external_update_id: String(externalUpdateId) });
  if (!error) return "new";
  // Postgres unique_violation
  if ((error as { code?: string }).code === "23505") return "duplicate";
  console.error("[telegram] claimUpdateOnce insert failed", error);
  return "error";
}

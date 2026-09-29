import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claims a Telegram update_id exactly once, using the DEDICATED
 * external_bot_updates table — never the internal bot's
 * assistant_channel_updates (that table's channel CHECK is locked to
 * 'TELEGRAM' and its sibling assistant_channel_identities maps external
 * ids to INTERNAL profiles, a concept that doesn't apply here — spec
 * §0's "two independent trust zones" rule means full separation, not
 * just a different channel value in a shared table).
 */
export async function claimExternalUpdateOnce(serviceClient: SupabaseClient, externalUpdateId: string | number): Promise<boolean> {
  const { error } = await serviceClient
    .from("external_bot_updates")
    .insert({ external_update_id: String(externalUpdateId) });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false; // already processed
  console.error("[external-telegram] claimExternalUpdateOnce insert failed", error);
  return false;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one legitimate pre-session lookup (spec §6) — no Supabase session
 * exists yet at this point in the webhook, so this is called with the
 * SERVICE-ROLE client, exactly mirroring the Trade Portal's own
 * token->assignment lookup (lib/trade/buyer.ts) for the identical
 * chicken-and-egg reason. Everything downstream of this call uses a
 * real, minted session instead (lib/assistant/telegram/session.ts) —
 * this function's only job is answering "whose profile is this."
 */
export async function resolveProfileForTelegramUser(
  serviceClient: SupabaseClient,
  telegramUserId: number,
): Promise<{ profileId: string } | null> {
  const { data, error } = await serviceClient
    .from("assistant_channel_identities")
    .select("profile_id")
    .eq("channel", "TELEGRAM")
    .eq("external_user_id", String(telegramUserId))
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return { profileId: data.profile_id };
}

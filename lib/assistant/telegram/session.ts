import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * DECISION CHANGE (documented, user-approved trade-off): this originally
 * minted a genuine per-user Supabase session (admin generateLink ->
 * verifyOtp) so `auth.uid()` and every RLS policy applied exactly as
 * they would for a real logged-in browser tab — see git history
 * (f84671f, cf90fcf) for that attempt. Live testing against this
 * project's actual Auth configuration made every verifyOtp call fail
 * immediately with a generic otp_expired/403 regardless of OTP type
 * ("email" and "magiclink" both, confirmed via diagnostic logging and
 * the Supabase dashboard's own Auth logs) — a project-specific Auth
 * behavior this session could not resolve without direct dashboard
 * access. Continuing to debug it was costing more than the two-user
 * bot's blast radius justified, so — with the user's explicit sign-off
 * — this now returns the service-role client instead.
 *
 * What that costs: RLS is bypassed for the Telegram channel specifically
 * (service-role has bypassrls) — every Action Registry handler's own
 * `requiredAccess` check (lib/assistant/actions/registry.ts, run in
 * orchestrator.ts BEFORE the handler executes) becomes the sole
 * permission gate for Telegram requests, not a second independent layer
 * on top of RLS the way the web UI still has. `write_log()`'s
 * `auth.uid()` attribution also records `null` for Telegram-originated
 * writes — the acting user is still fully recoverable via
 * assistant_pending_actions.user_id on the same row, just not from
 * activity_logs.user_id directly. `confirmPendingAction`/
 * `cancelPendingAction`'s own `.eq("user_id", userId)` ownership check
 * is a plain query condition, not an RLS policy, so it is UNAFFECTED —
 * a Telegram user still cannot confirm another user's pending action.
 *
 * profileId is accepted (matching the original signature) but unused —
 * kept so lib/assistant/telegram/handleUpdate.ts needed zero changes.
 */
export async function getSessionClientForProfile(_profileId: string): Promise<SupabaseClient> {
  return createServiceClient();
}

import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The one piece of real architecture in this file: Telegram carries no
 * Supabase session, but every Action Registry handler is written and
 * typed to assume a real, RLS-bound, authenticated client (lib/
 * assistant/actions/types.ts's ActionContext comment: "never
 * service-role"). Rather than hand the Telegram path a service-role
 * client — which would silently drop RLS as a second enforcement layer
 * under the ENTIRE registry, and would make write_log()'s auth.uid()
 * attribution record `null` — this mints a genuine session for the
 * mapped profile via Supabase's documented admin-generate-link ->
 * verify-otp exchange, so `auth.uid()` resolves exactly as it would for
 * a real logged-in browser tab. Cached briefly per profile (a Supabase
 * access token is normally valid ~1h) so a 2-user internal bot doesn't
 * re-mint on every single message.
 */

type CachedSession = { accessToken: string; refreshToken: string; expiresAt: number };
const sessionCache = new Map<string, CachedSession>();

const REFRESH_SKEW_MS = 60_000; // refresh a little before the token actually expires

async function mintSession(profileId: string): Promise<CachedSession> {
  const admin = createServiceClient();

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(profileId);
  if (userErr || !userRes.user?.email) {
    throw new Error(`telegram session: could not resolve an email for profile ${profileId}`);
  }
  const email = userRes.user.email;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`telegram session: generateLink failed for ${email}: ${linkErr?.message}`);
  }
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // `type: "email"` here — NOT "magiclink". "magiclink" is the OTP type
  // for a user-INITIATED signInWithOtp() flow; an ADMIN-generated link's
  // hashed_token (generateLink({type:"magiclink"}) above — that "type"
  // is the LINK kind, a separate concept) is verified as a generic
  // "email" OTP. Using "magiclink" here made every verifyOtp call fail
  // with a generic otp_expired/"Token has expired or is invalid" even
  // immediately after generation — confirmed live via the diagnostic
  // logging above before this fix.
  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({
    email,
    token: linkData.properties.hashed_token,
    type: "email",
  });
  if (otpErr || !otpData.session) {
    throw new Error(`telegram session: verifyOtp failed for ${email}: ${otpErr?.message}`);
  }

  const { access_token, refresh_token, expires_at } = otpData.session;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: (expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}

async function refreshCachedSession(cached: CachedSession): Promise<CachedSession> {
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.refreshSession({ refresh_token: cached.refreshToken });
  if (error || !data.session) throw new Error(`telegram session: refresh failed: ${error?.message}`);
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}

/**
 * Returns a plain, RLS-bound Supabase client authenticated as the given
 * profile — bearer-token style (no cookies involved, this is a webhook,
 * not a page render). Every query this client makes is subject to the
 * exact same RLS policies as if that user were using the web UI.
 */
export async function getSessionClientForProfile(profileId: string): Promise<SupabaseClient> {
  let cached = sessionCache.get(profileId);
  const now = Date.now();

  if (!cached) {
    cached = await mintSession(profileId);
    sessionCache.set(profileId, cached);
  } else if (cached.expiresAt - now < REFRESH_SKEW_MS) {
    try {
      cached = await refreshCachedSession(cached);
    } catch {
      // Refresh token may itself have expired (long idle period) — fall back to a fresh mint.
      cached = await mintSession(profileId);
    }
    sessionCache.set(profileId, cached);
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${cached.accessToken}` } },
  });
}

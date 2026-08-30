import "server-only";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/**
 * Service-role client. NEVER import this into a client component.
 * The `server-only` guard makes such an import a build error.
 * Used only for privileged server maintenance tasks that must bypass RLS.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

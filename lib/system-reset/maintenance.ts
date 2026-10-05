/**
 * Maintenance lock probe for the middleware (Edge runtime — no server-only imports here).
 * system_maintenance_status() returns only {locked: boolean}; it is callable with the public anon key on purpose.
 * Cached for a few seconds per instance so it adds at most one tiny request per few seconds, and it FAILS OPEN: if the probe
 * itself errors (e.g. the migration is not applied yet) the site keeps working — during a reset the database holds the real lock.
 */
const TTL_MS = 3000;
let cache: { locked: boolean; at: number } | null = null;

export async function isMaintenanceLocked(now: number = Date.now()): Promise<boolean> {
  if (cache && now - cache.at < TTL_MS) return cache.locked;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/system_maintenance_status`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      cache = { locked: false, at: now };
      return false;
    }
    const body = (await res.json()) as { locked?: boolean } | null;
    cache = { locked: body?.locked === true, at: now };
  } catch {
    cache = { locked: false, at: now };
  }
  return cache.locked;
}

/** Paths that stay reachable during a reset: the reset console itself (the initiating admin), login and static assets. */
export function allowedDuringMaintenance(path: string): boolean {
  return path.startsWith("/settings/system/factory-reset") || path.startsWith("/login") || path.startsWith("/_next") || path.startsWith("/favicon");
}

/** Test helper. */
export function _resetMaintenanceCache() {
  cache = null;
}

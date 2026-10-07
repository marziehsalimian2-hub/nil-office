import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isSha256Hex, isWellFormedToken } from "./format";
import { hashVerifyToken, sha256Hex } from "./token";
import type { HashCheckResult, PublicVerification } from "./types";

/**
 * Public verification access. Zero trust: a malformed token never reaches the database; every request is rate limited per pseudonymous
 * caller key; the database answers through service_role-only RPCs with a FIXED allow-list projection; any error becomes a generic
 * "not found" — no stack, no SQL text, no internal ids ever leave this module.
 */

export const PAGE_LIMIT = { scope: "VERIFY_PAGE", limit: 60, windowSeconds: 60 } as const;
export const CHECK_LIMIT = { scope: "VERIFY_CHECK", limit: 20, windowSeconds: 60 } as const;

/** The proxy appends the address it saw at the END of X-Forwarded-For; the first entries are client-controlled and spoofable. */
export function clientIp(h: { get(name: string): string | null }): string {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1].slice(0, 64);
  }
  return (h.get("x-real-ip") ?? "unknown").slice(0, 64);
}

/** SHA-256(ip | UTC day | server secret): the rate-limit bucket. The raw address is never stored; the key rotates daily. */
export function rateKey(ip: string, now: Date = new Date(), secret: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY): string {
  return sha256Hex(`${ip}|${now.toISOString().slice(0, 10)}|${secret ?? ""}`);
}

export async function allowRequest(scope: { scope: string; limit: number; windowSeconds: number }, ip: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("verify_rate_check", {
      p_scope: scope.scope, p_key: rateKey(ip), p_limit: scope.limit, p_window_seconds: scope.windowSeconds,
    });
    if (error) return true;       // a limiter outage must not break legitimate QR scans (the lookup itself would fail the same way)
    return data === true;
  } catch {
    return true;
  }
}

export async function lookupPublicVerification(token: string): Promise<PublicVerification> {
  if (!isWellFormedToken(token)) return { found: false };
  try {
    const { data, error } = await createServiceClient().rpc("verify_public_lookup", { p_token_hash: hashVerifyToken(token) });
    if (error || !data || (data as { found?: boolean }).found !== true) return { found: false };
    return data as PublicVerification;
  } catch {
    return { found: false };
  }
}

export async function checkFileHash(token: string, hash: string): Promise<HashCheckResult> {
  if (!isWellFormedToken(token)) return { found: false };
  if (!isSha256Hex(hash)) return { found: true, invalid: true, match: false };
  try {
    const { data, error } = await createServiceClient().rpc("verify_public_hash_check", { p_token_hash: hashVerifyToken(token), p_hash: hash.toLowerCase() });
    if (error || !data) return { found: false };
    return data as HashCheckResult;
  } catch {
    return { found: false };
  }
}

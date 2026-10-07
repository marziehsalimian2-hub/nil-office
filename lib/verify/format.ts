/** Pure helpers (client + server) for token shape, URL building and hash text. No secrets, no Node-only imports. */

/** A well-formed public token is exactly 43 base64url characters (32 random bytes). Anything else never reaches the database. */
export const VERIFY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isWellFormedToken = (t: unknown): t is string => typeof t === "string" && VERIFY_TOKEN_RE.test(t);

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export const isSha256Hex = (h: unknown): h is string => typeof h === "string" && SHA256_HEX_RE.test(h.toLowerCase());

/**
 * The QR content = this URL and nothing else. `base` is the deployment's own origin (NEXT_PUBLIC_APP_URL); http is accepted only for
 * localhost. Throws when the base is missing/invalid so a verification can never be activated with a broken or unsafe QR.
 */
export function buildVerifyUrl(base: string | undefined | null, token: string): string {
  if (!isWellFormedToken(token)) throw new Error("VERIFY_TOKEN_INVALID");
  const raw = (base ?? "").trim().replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("VERIFY_BASE_URL_MISSING");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("VERIFY_BASE_URL_MISSING");
  if (u.pathname !== "/" || u.search || u.hash) throw new Error("VERIFY_BASE_URL_MISSING");
  return `${u.origin}/verify/${token}`;
}

/** Display form of a hash for UI («a1b2c3…»). */
export const shortHash = (h: string | null | undefined, n = 12) => (h ? h.slice(0, n) : "—");

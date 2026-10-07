import { NextResponse, type NextRequest } from "next/server";
import { allowRequest, checkFileHash, clientIp, CHECK_LIMIT } from "@/lib/verify/public";
import { isSha256Hex, isWellFormedToken } from "@/lib/verify/format";

export const dynamic = "force-dynamic";

/**
 * Public file-authenticity check. The browser computes the SHA-256 of the chosen PDF itself (Web Crypto) and sends ONLY the hash —
 * the file never leaves the device and nothing is stored. The answer is a fixed small shape; every failure is generic (no DB text,
 * no stack, no ids). Rate limited per pseudonymous caller key.
 */
export async function POST(req: NextRequest) {
  const generic = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (!(await allowRequest(CHECK_LIMIT, clientIp(req.headers)))) return generic(429, { error: "RATE_LIMITED" });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return generic(400, { error: "INVALID_REQUEST" });
    }
    const { token, hash } = (body ?? {}) as { token?: unknown; hash?: unknown };
    if (!isWellFormedToken(token) || !isSha256Hex(hash)) return generic(400, { error: "INVALID_REQUEST" });

    const r = await checkFileHash(token, hash);
    if (!r.found) return generic(200, { found: false });
    if ("invalid" in r) return generic(200, { found: true, invalid: true, match: false });
    return generic(200, { found: true, match: r.match, status: r.status });
  } catch {
    return generic(500, { error: "UNAVAILABLE" });
  }
}

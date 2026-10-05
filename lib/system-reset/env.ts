/**
 * Factory Reset — environment guard. The environment is decided ONLY on the server, from the server's own env vars:
 *   NIL_ENVIRONMENT              development | uat | production   (missing / anything else => production, i.e. the strictest)
 *   NIL_ALLOW_PRODUCTION_RESET   "true"  — the explicit server-side capability a production reset needs
 * Nothing the browser sends can change either value. The database re-checks the same rule (system_reset_* RPCs, migration 0141).
 */
export const RESET_ENVIRONMENTS = ["development", "uat", "production"] as const;
export type ResetEnvironment = (typeof RESET_ENVIRONMENTS)[number];

export function resetEnvironment(raw: string | undefined = process.env.NIL_ENVIRONMENT): ResetEnvironment {
  const v = raw?.trim().toLowerCase();
  return (RESET_ENVIRONMENTS as readonly string[]).includes(v ?? "") ? (v as ResetEnvironment) : "production";
}

export function productionResetAllowed(raw: string | undefined = process.env.NIL_ALLOW_PRODUCTION_RESET): boolean {
  return raw?.trim() === "true";
}

export type ResetGuard = { allowed: true } | { allowed: false; reason: "PRODUCTION_BLOCKED" };

export function resetGuard(env: ResetEnvironment, allowProduction: boolean): ResetGuard {
  if (env === "production" && !allowProduction) return { allowed: false, reason: "PRODUCTION_BLOCKED" };
  return { allowed: true };
}

/** Read straight from the environment; used by the server actions and the page. */
export function currentResetGuard(): { env: ResetEnvironment; allowProduction: boolean; guard: ResetGuard } {
  const env = resetEnvironment();
  const allowProduction = productionResetAllowed();
  return { env, allowProduction, guard: resetGuard(env, allowProduction) };
}

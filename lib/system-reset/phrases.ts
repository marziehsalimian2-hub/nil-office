import type { ResetEnvironment } from "./env";

/** Typed confirmation phrases. The SAME string is enforced inside the database (system_reset_arm), a frontend modal is never the only gate. */
export const OPERATIONAL_PHRASE = "RESET NIL OFFICE";

/** Full factory reset (not executable in v1) needs a stronger, environment-specific phrase. */
export function fullResetPhrase(env: ResetEnvironment): string {
  return `FULL FACTORY RESET ${env.toUpperCase()}`;
}

export function expectedPhrase(mode: "OPERATIONAL" | "FULL", env: ResetEnvironment): string {
  return mode === "FULL" ? fullResetPhrase(env) : OPERATIONAL_PHRASE;
}

/** Exact match (only leading / trailing whitespace is forgiven). */
export function phraseMatches(mode: "OPERATIONAL" | "FULL", env: ResetEnvironment, input: string | null | undefined): boolean {
  return typeof input === "string" && input.trim() === expectedPhrase(mode, env);
}

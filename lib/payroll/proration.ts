import { toFaDigits } from "@/lib/jalali";

/**
 * Display helpers for calendar-day proration (Phase 9, PAYROLL_ENGINE_3). Pure — no money arithmetic here:
 * the amounts are computed by the database; these only read the two day counts it stored as a trace
 * (`details.proration` on a line, `inputs.proration` on the person's result).
 */

export type Proration = { employed_days: number; period_days: number };

/** Reads `{employed_days, period_days}` from a stored trace; anything malformed → null (nothing is shown rather than guessed). */
export function readProration(v: unknown): Proration | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const e = Number(o.employed_days);
  const p = Number(o.period_days);
  if (!Number.isInteger(e) || !Number.isInteger(p) || p < 1 || e < 0 || e > p) return null;
  return { employed_days: e, period_days: p };
}

/** «متناسب با ۱۰ روز از ۳۱ روز» */
export function describeProration(p: Proration | null | undefined): string | null {
  if (!p) return null;
  return `متناسب با ${toFaDigits(p.employed_days)} روز از ${toFaDigits(p.period_days)} روز`;
}

/** The person-level notice on the result screen: only when the engine really applied the ratio. */
export function personProration(inputs: Record<string, unknown> | null | undefined): Proration | null {
  const raw = inputs?.proration as Record<string, unknown> | undefined;
  if (!raw || raw.applied !== true) return null;
  return readProration(raw);
}

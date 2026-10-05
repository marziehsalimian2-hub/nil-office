import { z } from "zod";

/**
 * Every field the browser may send to the Factory Reset actions. The client NEVER sends table names, SQL or storage paths —
 * the scope comes from the server-side manifest. All schemas are strict: an unexpected field is an error, not ignored.
 */

/** Numbering scopes of number_sequences (CHECK ck_sequence_scope, 0118). The baseline is the LAST USED number (next one = +1). */
export const NUMBERING_SCOPES = [
  "OUTGOING", "INCOMING", "CASE", "CONTRACT", "PROFORMA", "INVOICE", "OPPORTUNITY", "PROJECT",
  "OFFER", "CHEQUE", "RECEIPT", "PAYMENT", "PERSONNEL", "PAYROLL_BATCH",
] as const;
export type NumberingScope = (typeof NUMBERING_SCOPES)[number];

/** User decision: the paper archive continues after OUTGOING 69 / INCOMING 18; every other scope starts from 0. */
export const DEFAULT_BASELINES: Record<NumberingScope, number> = Object.fromEntries(
  NUMBERING_SCOPES.map((s) => [s, s === "OUTGOING" ? 69 : s === "INCOMING" ? 18 : 0]),
) as Record<NumberingScope, number>;

const baselineValue = z.coerce.number().int().min(0).max(99_999_999);

export const dryRunSchema = z
  .object({
    mode: z.enum(["OPERATIONAL", "FULL"]),
    baselines: z.object(Object.fromEntries(NUMBERING_SCOPES.map((s) => [s, baselineValue])) as Record<NumberingScope, typeof baselineValue>).strict(),
  })
  .strict();

const uuid = z.string().uuid();

export const armSchema = z
  .object({
    plan_id: uuid,
    phrase: z.string().min(1).max(100),
    second_confirm: z.literal(true),
    backup_reference: z.string().trim().min(4).max(200),
    backup_timestamp: z.string().datetime({ offset: true }),
    backup_status: z.literal("CONFIRMED_BY_ADMIN"),
  })
  .strict();

export const executeSchema = z.object({ plan_id: uuid, token: z.string().min(20).max(200) }).strict();
export const cancelSchema = z.object({ plan_id: uuid }).strict();
export const runSchema = z.object({ run_id: uuid }).strict();

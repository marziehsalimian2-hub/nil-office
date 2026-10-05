import { meetsStrict, type EntityType } from "./entityMatch";

/**
 * In-process ledger of entities that were RESOLVED by the code-level resolver (Slice 3, spec §19 / §46) — the thing
 * that lets a write proposal prove "this company id was not guessed". Three small, expiring, user-bound stores:
 *
 *  - resolved: (user, type, id) -> how it was resolved (AUTO with score/margin, or USER_PICKED by a button tap)
 *  - offers:   (user, type) -> ids shown as AMBIGUOUS candidates; they only become resolved by a human choice
 *  - picks:    opaque one-time tokens behind the Telegram «pick:<token>» buttons (callback_data carries no id or name)
 *
 * In-memory on purpose and for the same reason as pendingAttachment.ts: this deployment is one persistent PM2 process;
 * nothing sensitive is stored (an id and a display name), and after a restart the model is simply asked to resolve
 * again. TTL keeps it short-lived. Pure TypeScript (no "server-only") so it is unit-tested directly.
 */

export const LEDGER_TTL_MS = 30 * 60 * 1000;
export const PICK_TTL_MS = 15 * 60 * 1000;

export type ResolvedEntry = { name: string; score: number; margin: number; how: "AUTO" | "USER_PICKED"; expiresAt: number };

const resolved = new Map<string, ResolvedEntry>();
const offers = new Map<string, { ids: Set<string>; expiresAt: number }>();
const picks = new Map<string, { userId: string; type: EntityType; id: string; name: string; expiresAt: number }>();

const key = (userId: string, type: EntityType, id: string) => `${userId}|${type}|${id}`;
const offerKey = (userId: string, type: EntityType) => `${userId}|${type}`;
const now = () => Date.now();

function purge(): void {
  const t = now();
  for (const [k, v] of resolved) if (v.expiresAt <= t) resolved.delete(k);
  for (const [k, v] of offers) if (v.expiresAt <= t) offers.delete(k);
  for (const [k, v] of picks) if (v.expiresAt <= t) picks.delete(k);
}

export function rememberResolved(userId: string, type: EntityType, id: string, name: string, score: number, margin: number, how: "AUTO" | "USER_PICKED"): void {
  purge();
  const existing = resolved.get(key(userId, type, id));
  // a human choice is never downgraded by a later automatic match
  if (existing && existing.how === "USER_PICKED" && how === "AUTO") {
    existing.expiresAt = now() + LEDGER_TTL_MS;
    return;
  }
  resolved.set(key(userId, type, id), { name, score, margin, how, expiresAt: now() + LEDGER_TTL_MS });
}

export function getResolved(userId: string, type: EntityType, id: string): ResolvedEntry | null {
  purge();
  return resolved.get(key(userId, type, id)) ?? null;
}

/** Record ids that were shown as ambiguous candidates (they must not be auto-resolved by a model re-query). */
export function offerCandidates(userId: string, type: EntityType, ids: string[]): void {
  purge();
  offers.set(offerKey(userId, type), { ids: new Set(ids), expiresAt: now() + LEDGER_TTL_MS });
}

export function wasOffered(userId: string, type: EntityType, id: string): boolean {
  purge();
  return offers.get(offerKey(userId, type))?.ids.has(id) ?? false;
}

const TYPE_FA: Record<EntityType, string> = { company: "شرکت", contact: "مخاطب", contract: "قرارداد", project: "پروژه" };
const TOOL_FOR: Record<EntityType, string> = { company: "SEARCH_COMPANY", contact: "SEARCH_CONTACT", contract: "SEARCH_CONTRACT", project: "SEARCH_PROJECT" };
export const typeLabelFa = (t: EntityType) => TYPE_FA[t];

/**
 * The guard every write action calls for an entity id it received from the model. Throws a Persian message the model
 * can act on when the id was never resolved by the resolver in this session (guessed, remembered from an old turn,
 * copied from a document), when it expired, or — for financial / official actions (`strict`) — when the match was not
 * convincing enough and no human has picked it.
 */
export function requireResolved(userId: string, type: EntityType, id: string | null | undefined, opts: { strict?: boolean } = {}): void {
  if (!id) return;
  const entry = getResolved(userId, type, id);
  const tool = TOOL_FOR[type];
  if (!entry) {
    throw new Error(`${TYPE_FA[type]} انتخاب‌شده هنوز تأیید نشده است (شناسهٔ حدسی/قدیمی پذیرفته نمی‌شود). ابتدا نام ${TYPE_FA[type]} را با ${tool} پیدا کن؛ اگر چند گزینه بود از کاربر بپرس.`);
  }
  if (opts.strict && !meetsStrict(entry)) {
    throw new Error(`برای این عملیات مالی/رسمی تطبیق ${TYPE_FA[type]} «${entry.name}» به‌اندازهٔ کافی قطعی نیست. از کاربر بپرس «منظورتان ${entry.name} است؟» و با دکمهٔ انتخاب یا نام کامل و دقیق تأیید بگیر، سپس دوباره با ${tool} جست‌وجو کن.`);
  }
}

// ---------------------------------------------------------------- pick tokens (Telegram buttons)
function newToken(): string {
  // 10 chars of base36 — short enough for callback_data (64 bytes) with the "pick:" prefix, unguessable enough for a 15-minute single-use token
  let s = "";
  while (s.length < 10) s += Math.random().toString(36).slice(2);
  return s.slice(0, 10);
}

export function createPickToken(userId: string, type: EntityType, id: string, name: string): string {
  purge();
  const token = newToken();
  picks.set(token, { userId, type, id, name, expiresAt: now() + PICK_TTL_MS });
  return token;
}

/** Single-use, user-bound: another user's token (or a replay) returns null. */
export function consumePickToken(token: string, userId: string): { type: EntityType; id: string; name: string } | null {
  purge();
  const entry = picks.get(token);
  if (!entry || entry.userId !== userId) return null;
  picks.delete(token);
  return { type: entry.type, id: entry.id, name: entry.name };
}

/** Test helper — clears all in-memory state. */
export function __resetLedger(): void {
  resolved.clear();
  offers.clear();
  picks.clear();
}

/**
 * Deterministic entity matching for the Assistant (Slice 3, spec §19 / §45). Pure — no DB, no "server-only" —
 * unit-tested in entityMatch.test.ts. The database only FETCHES plausible candidates
 * (assistant_entity_candidates, 0136); everything that decides "is this the company the user meant?" is here, so
 * the decision is reproducible and never left to the model.
 */

export type EntityType = "company" | "contact" | "contract" | "project";

// ---------------------------------------------------------------- normalization
const CHAR_MAP: Record<string, string> = {
  "ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "ٱ": "ا", "ؤ": "و",
};
const DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

/**
 * Persian-aware normal form: Arabic ي/ك/ى/ئ/ة → Persian forms, ZWNJ/ZWJ/NBSP → space, tatweel + diacritics
 * removed, Persian/Arabic digits → ASCII, Latin lower-cased, punctuation → space, spaces collapsed.
 */
export function normalizeFa(input: string | null | undefined): string {
  let s = String(input ?? "").normalize("NFKC");
  s = s.replace(/[‌‍ ]/g, " ").replace(/[ـً-ٰٟء]/g, "");
  s = s.replace(/[يىئكةۀأإٱؤ]/g, (c) => CHAR_MAP[c] ?? c).replace(/[۰-۹٠-٩]/g, (c) => DIGIT_MAP[c] ?? c);
  s = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

const LEGAL_TOKENS = new Set([
  "شرکت", "گروه", "موسسه", "سازمان", "بنیاد", "هلدینگ", "co", "company", "corp", "corporation", "inc", "ltd", "limited",
  "llc", "gmbh", "pjsc", "jsc", "plc", "ag", "sa", "group", "holding",
]);
const LEGAL_PHRASES = ["سهامی خاص", "سهامی عام", "با مسئولیت محدود", "مسئولیت محدود", "مسیولیت محدود"];

/** Normal form with legal-form words («شرکت», «Co.», «سهامی خاص» …) removed — used only for comparison. */
export function stripLegalWords(normalized: string): string {
  let s = ` ${normalized} `;
  // (the regex word boundary is ASCII-only in JS, so phrases are removed on space boundaries instead)
  for (const phrase of LEGAL_PHRASES) s = s.split(` ${phrase} `).join(" ");
  const kept = s.split(" ").filter((t) => t !== "" && !LEGAL_TOKENS.has(t));
  return kept.length > 0 ? kept.join(" ") : normalized;
}

const tokens = (s: string) => (s === "" ? [] : s.split(" "));

function bigrams(s: string): string[] {
  const t = s.replace(/ /g, "");
  if (t.length < 2) return t ? [t] : [];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const n = counts.get(g) ?? 0;
    if (n > 0) { overlap++; counts.set(g, n - 1); }
  }
  return (2 * overlap) / (A.length + B.length);
}

// ---------------------------------------------------------------- scoring
/** Score 0..1 of ONE candidate name against the query. Exact = 1, exact without legal words = 0.97, token containment 0.80-0.92, fuzzy ≤ 0.78. */
export function scoreName(query: string, candidate: string): number {
  const q = normalizeFa(query);
  const c = normalizeFa(candidate);
  if (q === "" || c === "") return 0;
  if (q === c) return 1;
  const qs = stripLegalWords(q);
  const cs = stripLegalWords(c);
  if (qs === cs) return 0.97;

  const qt = tokens(qs);
  const ct = tokens(cs);
  const [small, big] = qt.length <= ct.length ? [qt, ct] : [ct, qt];
  if (small.length > 0 && small.every((t) => big.includes(t))) {
    const coverage = small.length / big.length;                   // 1 only when the token sets are equal (handled above)
    const cap = qt.length <= ct.length ? 0.92 : 0.88;              // the user said MORE than the candidate's name: slightly less sure
    return Math.min(cap, 0.8 + 0.12 * coverage);
  }
  return Math.min(0.78, dice(qs, cs));
}

/** Best score over a candidate's name + aliases (english name, document numbers …). */
export function scoreMatch(query: string, names: (string | null | undefined)[]): number {
  let best = 0;
  for (const n of names) if (n) best = Math.max(best, scoreName(query, n));
  return best;
}

// ---------------------------------------------------------------- tiers
export type Tier = "RESOLVED" | "AMBIGUOUS" | "WEAK" | "NONE";

export const THRESHOLDS = {
  normal: { min: 0.92, gap: 0.12 },
  /** financial / official actions (receipt, payment, invoice, letters, service report) — spec §45 */
  strict: { min: 0.97, gap: 0.25 },
} as const;
export const PLAUSIBLE_MIN = 0.55;
export const FLOOR = 0.45;

export type Scored = { id: string; score: number };
export type Classification = { tier: Tier; top: Scored | null; margin: number; ranked: Scored[] };

/**
 * RESOLVED  — one clear winner (score ≥ min and ≥ gap ahead of the runner-up)
 * AMBIGUOUS — two or more plausible candidates, no clear winner: the user must choose
 * WEAK      — a single plausible but not convincing candidate: ask «منظورتان … است؟»
 * NONE      — nothing plausible: ask for a better spelling, never guess
 */
export function classify(scored: Scored[], mode: "normal" | "strict" = "normal"): Classification {
  const ranked = scored.filter((s) => s.score >= FLOOR).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { tier: "NONE", top: null, margin: 0, ranked };
  const top = ranked[0];
  const second = ranked[1]?.score ?? 0;
  const margin = top.score - second;
  const t = THRESHOLDS[mode];
  if (top.score >= t.min && margin >= t.gap) return { tier: "RESOLVED", top, margin, ranked };
  const plausible = ranked.filter((r) => r.score >= PLAUSIBLE_MIN);
  if (plausible.length >= 2) return { tier: "AMBIGUOUS", top, margin, ranked };
  if (plausible.length === 1) return { tier: "WEAK", top, margin, ranked };
  return { tier: "NONE", top: null, margin: 0, ranked };
}

/** True when `how` + score + margin satisfy the strict bar (financial / official actions). A human button tap always does. */
export function meetsStrict(e: { how: "AUTO" | "USER_PICKED"; score: number; margin: number }): boolean {
  return e.how === "USER_PICKED" || (e.score >= THRESHOLDS.strict.min && e.margin >= THRESHOLDS.strict.gap);
}

/**
 * Did the HUMAN's own message name this candidate? (the web has no buttons: a typed, more specific name is the user's
 * choice). True when the normalized message contains the candidate's normalized name (legal words stripped) as whole tokens.
 */
export function humanMentioned(userMessage: string | undefined, names: (string | null | undefined)[]): boolean {
  const m = ` ${stripLegalWords(normalizeFa(userMessage))} `;
  if (m.trim() === "") return false;
  return names.some((n) => {
    if (!n) return false;
    const c = stripLegalWords(normalizeFa(n));
    return c !== "" && m.includes(` ${c} `);
  });
}

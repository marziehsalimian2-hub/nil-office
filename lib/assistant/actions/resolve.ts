import "server-only";
import { z } from "zod";
import { classify, humanMentioned, meetsStrict, scoreMatch, type EntityType, type Tier } from "@/lib/assistant/entityMatch";
import { createPickToken, getResolved, offerCandidates, rememberResolved, typeLabelFa, wasOffered } from "@/lib/assistant/entityLedger";
import type { ActionContext, ActionDefinition, ReadActionResult, ResultCard } from "./types";
import type { Profile } from "@/lib/types/database";

/**
 * The code-level entity resolver behind SEARCH_COMPANY / SEARCH_CONTRACT / SEARCH_PROJECT / SEARCH_CONTACT
 * (Slice 3, spec §19 / §45 / §46). The database only FETCHES plausible candidates (assistant_entity_candidates, 0136);
 * scoring, tiers and "is this resolved?" are decided here, deterministically (entityMatch.ts):
 *
 *   RESOLVED  — one clear winner: its id is recorded in the ledger and write actions may use it;
 *   AMBIGUOUS — several plausible candidates: NOTHING is recorded; the user must choose (Telegram: inline buttons whose
 *               tap is the only way to resolve such a set; web: type the more specific name);
 *   WEAK      — one unconvincing candidate: ask «منظورتان … است؟»;
 *   NONE      — nothing plausible: ask for a better spelling, never guess.
 *
 * An id that was offered as an ambiguous candidate is NOT auto-resolved by a later model re-query unless the human's own
 * message names it — otherwise the model could "choose" for the user by searching the exact name.
 */

type Row = { id: string; name: string; aliases?: (string | null)[]; secondary?: string | null; number?: string | null; company_id?: string | null };
type Cand = { id: string; name: string; secondary: string | null; number: string | null; score: number; companyId: string | null; names: string[] };

const MAX_SHOWN = 5;
const CARD_KIND: Record<EntityType, ResultCard["kind"]> = { company: "company", contact: "company", contract: "contract", project: "project" };
const HREF: Record<EntityType, (c: Cand) => string> = {
  company: (c) => `/companies/${c.id}`,
  contact: (c) => `/companies/${c.companyId ?? c.id}`,
  contract: (c) => `/contracts/${c.id}`,
  project: (c) => `/projects/${c.id}`,
};

const label = (c: Cand) => {
  const l = `${c.name}${c.secondary ? ` — ${c.secondary}` : ""}`;
  return l.length > 60 ? `${l.slice(0, 57)}…` : l;
};

export type ResolverOutput = {
  tier: Tier;
  query: string;
  resolved: { id: string; name: string; secondary: string | null; number: string | null } | null;
  strict_ok: boolean;
  candidates: { name: string; secondary: string | null; number: string | null }[];
  instruction: string;
};

export async function resolveEntity(ctx: ActionContext, type: EntityType, query: string, opts: { companyId?: string } = {}): Promise<ReadActionResult> {
  const { data, error } = await ctx.supabase.rpc("assistant_entity_candidates", {
    p_profile_id: ctx.userId, p_type: type, p_query: query, p_company_id: opts.companyId ?? null, p_limit: 25,
  });
  if (error) {
    if (error.message.includes("NOT_AUTHORIZED")) throw new Error("به این بخش دسترسی ندارید.");
    console.error("[assistant] assistant_entity_candidates failed", error.message);
    throw new Error("جست‌وجو ناموفق بود؛ دوباره تلاش کن.");
  }

  const cands: Cand[] = ((data ?? []) as Row[])
    .map((r) => {
      const names = [r.name, ...(r.aliases ?? []), r.number].filter((n): n is string => !!n);
      return { id: r.id, name: r.name, secondary: r.secondary ?? null, number: r.number ?? null, score: scoreMatch(query, names), companyId: r.company_id ?? null, names };
    })
    .filter((c) => c.score > 0);

  // A candidate the HUMAN already picked with a button wins outright (a duplicate name elsewhere cannot make it ambiguous again).
  const picked = cands.filter((c) => c.score >= 0.55 && getResolved(ctx.userId, type, c.id)?.how === "USER_PICKED").sort((a, b) => b.score - a.score)[0];
  const cls = classify(cands.map((c) => ({ id: c.id, score: c.score })));
  const byId = new Map(cands.map((c) => [c.id, c]));
  const shown = cls.ranked.slice(0, MAX_SHOWN).map((r) => byId.get(r.id)!).filter((c) => c.score >= 0.55);
  const L = typeLabelFa(type);

  let tier: Tier = cls.tier;
  let winner: Cand | null = cls.top ? byId.get(cls.top.id)! : null;
  let score = cls.top?.score ?? 0;
  let margin = cls.margin;
  let how: "AUTO" | "USER_PICKED" = "AUTO";

  if (picked) {
    tier = "RESOLVED"; winner = picked; score = 1; margin = 1; how = "USER_PICKED";
  } else if (tier === "RESOLVED" && winner && wasOffered(ctx.userId, type, winner.id) && !humanMentioned(ctx.userMessageText, winner.names)) {
    tier = "WEAK";          // the model re-queried an ambiguous candidate by its exact name: that is not the user's choice
  }

  const cards: ResultCard[] = [];
  const choices: { token: string; label: string }[] = [];
  const out: ResolverOutput = { tier, query, resolved: null, strict_ok: false, candidates: [], instruction: "" };

  if (tier === "RESOLVED" && winner) {
    rememberResolved(ctx.userId, type, winner.id, winner.name, score, margin, how);
    out.resolved = { id: winner.id, name: winner.name, secondary: winner.secondary, number: winner.number };
    out.strict_ok = meetsStrict({ how, score, margin });
    cards.push({ kind: CARD_KIND[type], id: winner.id, title: winner.name, subtitle: winner.secondary ?? undefined, href: HREF[type](winner) });
    if (out.strict_ok) {
      out.instruction = `${L} «${winner.name}» با اطمینان بالا تشخیص داده شد؛ می‌توانی از شناسهٔ آن استفاده کنی.`;
    } else {
      out.instruction = `${L} «${winner.name}» تشخیص داده شد، ولی برای عملیات مالی/رسمی (دریافت، پرداخت، فاکتور، نامه، گزارش مشتری) تطبیق به‌اندازهٔ کافی قطعی نیست: از کاربر بپرس «منظورتان ${winner.name} است؟» (دکمهٔ تأیید هم نمایش داده می‌شود)؛ برای کارهای عادی (کار، پیگیری) می‌توانی ادامه بدهی.`;
      choices.push({ token: createPickToken(ctx.userId, type, winner.id, winner.name), label: `✅ ${label(winner)}` });
    }
  } else if (tier === "AMBIGUOUS" || tier === "WEAK") {
    const list = shown.length > 0 ? shown : winner ? [winner] : [];
    offerCandidates(ctx.userId, type, list.map((c) => c.id));
    out.candidates = list.map((c) => ({ name: c.name, secondary: c.secondary, number: c.number }));
    for (const c of list) {
      cards.push({ kind: CARD_KIND[type], id: c.id, title: c.name, subtitle: c.secondary ?? undefined, href: HREF[type](c) });
      choices.push({ token: createPickToken(ctx.userId, type, c.id, c.name), label: label(c) });
    }
    out.instruction = tier === "AMBIGUOUS"
      ? `چند ${L} مشابه پیدا شد. فهرست را به کاربر نشان بده و بپرس کدام را می‌خواهد (دکمه‌های انتخاب خودکار زیر پیام نمایش داده می‌شود). تا کاربر انتخاب نکرده هیچ ابزار نوشتنی را با این ${L} فراخوانی نکن و خودت یکی را انتخاب نکن.`
      : `فقط یک تطبیق ضعیف پیدا شد: «${out.candidates[0]?.name}». از کاربر بپرس همین منظورش است؟ تا تأیید نکرده با آن ابزار نوشتنی فراخوانی نکن.`;
  } else {
    out.instruction = `${L}ی پیدا نشد. املای دقیق‌تر یا نام کامل را از کاربر بپرس؛ حدس نزن.`;
  }

  return { data: out, cards, choices: choices.length > 0 ? choices : undefined };
}

type ResolverActionOpts = {
  name: string;
  description: string;
  type: EntityType;
  requiredAccess?: (p: Profile) => boolean;
  scopedByCompany?: boolean;
};

/** One factory for the resolver-backed search tools — same tool names as before, so every prompt / description that mentions them stays valid. */
export function makeResolverAction(opts: ResolverActionOpts): ActionDefinition<{ query: string; company_id?: string }> {
  return {
    name: opts.name,
    description: opts.description,
    riskLevel: "LOW",
    requiresConfirmation: false,
    requiredAccess: opts.requiredAccess,
    inputSchema: opts.scopedByCompany
      ? z.object({ query: z.string().trim().min(1, "عبارت جست‌وجو الزامی است."), company_id: z.string().uuid().optional() })
      : z.object({ query: z.string().trim().min(1, "عبارت جست‌وجو الزامی است.") }),
    handler: (input, ctx) => resolveEntity(ctx, opts.type, input.query, { companyId: input.company_id }),
  };
}

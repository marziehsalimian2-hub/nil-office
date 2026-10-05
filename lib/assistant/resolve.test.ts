import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";
import { resolveEntity, type ResolverOutput } from "./actions/resolve";
import { requireResolved, getResolved, consumePickToken, __resetLedger } from "./entityLedger";
import type { ActionContext } from "./actions/types";

const USER = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = { id: string; name: string; aliases?: (string | null)[]; secondary?: string | null; number?: string | null };

function ctxWith(rows: Row[], over: Partial<ActionContext> = {}, rpcError?: string): ActionContext & { rpcCalls: Record<string, unknown>[] } {
  const rpcCalls: Record<string, unknown>[] = [];
  const supabase = {
    rpc: (_fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      return Promise.resolve(rpcError ? { data: null, error: { message: rpcError } } : { data: rows, error: null });
    },
  } as unknown as SupabaseClient;
  return { supabase, userId: USER, profile: { id: USER, role: "USER" } as unknown as Profile, rpcCalls, ...over };
}

const out = async (ctx: ActionContext, query: string, type: "company" | "contract" | "project" | "contact" = "company") => {
  const r = await resolveEntity(ctx, type, query);
  return { data: r.data as ResolverOutput, r };
};

const REZAEI = [
  { id: id(1), name: "شرکت رضایی", aliases: ["Rezaei Co"], secondary: "ایران" },
  { id: id(2), name: "رضایی صنعت", secondary: "ایران" },
  { id: id(3), name: "رضایی تجارت", secondary: "ایران" },
];

beforeEach(() => __resetLedger());

describe("resolveEntity — tiers", () => {
  it("an exact full name resolves, is recorded in the ledger and may be used by a write action", async () => {
    const ctx = ctxWith(REZAEI);
    const { data } = await out(ctx, "رضایی صنعت");
    expect(data.tier).toBe("RESOLVED");
    expect(data.resolved).toMatchObject({ id: id(2), name: "رضایی صنعت" });
    expect(() => requireResolved(USER, "company", id(2))).not.toThrow();
  });

  it("«رضایی» with several similar companies is AMBIGUOUS: nothing is resolved, no id is handed out, buttons are offered", async () => {
    const ctx = ctxWith(REZAEI);
    const { data, r } = await out(ctx, "رضایی");
    expect(data.tier).toBe("AMBIGUOUS");
    expect(data.resolved).toBeNull();
    expect(data.candidates.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data)).not.toContain(id(1));                       // the model gets names, not ids, for an unresolved set
    for (const n of [1, 2, 3]) expect(() => requireResolved(USER, "company", id(n))).toThrow();
    expect(r.choices?.length).toBe(3);
    expect(data.instruction).toContain("هیچ ابزار نوشتنی");
  });

  it("a persian/arabic spelling variant of an exact name still resolves", async () => {
    const ctx = ctxWith([{ id: id(5), name: "کارخانه رضایی" }, { id: id(6), name: "پارس آتیه" }]);
    const { data } = await out(ctx, "كارخانه رضايي");
    expect(data.tier).toBe("RESOLVED");
    expect(data.resolved?.id).toBe(id(5));
  });

  it("a single middling match is WEAK («منظورتان … است؟») and not usable", async () => {
    const ctx = ctxWith([{ id: id(7), name: "رضایی صنعت و تجارت پارس" }, { id: id(8), name: "آسمان" }]);
    const { data, r } = await out(ctx, "رضایی");
    expect(data.tier).toBe("WEAK");
    expect(() => requireResolved(USER, "company", id(7))).toThrow();
    expect(r.choices?.length).toBe(1);
  });

  it("nothing plausible is NONE and says not to guess", async () => {
    const { data, r } = await out(ctxWith([{ id: id(9), name: "کاملاً نامرتبط" }]), "رضایی");
    expect(data.tier).toBe("NONE");
    expect(data.instruction).toContain("حدس نزن");
    expect(r.choices).toBeUndefined();
  });

  it("two entities with the same exact name are never auto-resolved", async () => {
    const { data } = await out(ctxWith([{ id: id(1), name: "شرکت الف" }, { id: id(2), name: "شرکت الف" }]), "شرکت الف");
    expect(data.tier).toBe("AMBIGUOUS");
  });

  it("document numbers match as exact fields", async () => {
    const ctx = ctxWith([{ id: id(1), name: "قرارداد خدمات", number: "CON-1405-0007" }, { id: id(2), name: "قرارداد دیگر", number: "CON-1405-0008" }]);
    const { data } = await out(ctx, "con-1405-0007", "contract");
    expect(data.tier).toBe("RESOLVED");
    expect(data.resolved?.id).toBe(id(1));
  });
});

describe("resolveEntity — strict bar (financial / official)", () => {
  it("a partial-name match is never strict-usable: it stays WEAK, offers a confirmation button, and a financial write is refused", async () => {
    // "رضایی صنعت" typed as a query only token-matches «رضایی صنعت و تجارت» (~0.86) — not exact, so it cannot reach a money action
    const ctx = ctxWith([{ id: id(1), name: "رضایی صنعت و تجارت" }, { id: id(2), name: "پارس آتیه" }]);
    const { data, r } = await out(ctx, "رضایی صنعت");
    expect(data.tier).toBe("WEAK");
    expect(r.choices?.length).toBe(1);
    expect(() => requireResolved(USER, "company", id(1), { strict: true })).toThrow();
  });

  it("an exact name passes the strict bar", async () => {
    const { data } = await out(ctxWith([{ id: id(1), name: "شرکت پارس آتیه" }, { id: id(2), name: "رضایی" }]), "شرکت پارس آتیه");
    expect(data.strict_ok).toBe(true);
    expect(() => requireResolved(USER, "company", id(1), { strict: true })).not.toThrow();
  });
});

describe("resolveEntity — the model cannot choose for the user", () => {
  it("re-querying an offered candidate by its exact name does NOT resolve it", async () => {
    const ctx = ctxWith(REZAEI, { userMessageText: "برای رضایی نامه بنویس" });
    await out(ctx, "رضایی");                                                  // AMBIGUOUS → candidates offered
    const { data } = await out(ctx, "رضایی صنعت");                            // the model "picks" one itself
    expect(data.tier).not.toBe("RESOLVED");
    expect(() => requireResolved(USER, "company", id(2))).toThrow();
  });

  it("…but a name the HUMAN typed in their own message does (the web has no buttons)", async () => {
    const first = ctxWith(REZAEI, { userMessageText: "برای رضایی نامه بنویس" });
    await out(first, "رضایی");
    const second = ctxWith(REZAEI, { userMessageText: "رضایی صنعت" });
    const { data } = await out(second, "رضایی صنعت");
    expect(data.tier).toBe("RESOLVED");
    expect(() => requireResolved(USER, "company", id(2))).not.toThrow();
  });

  it("a button tap is the strongest answer: it resolves even if the name is duplicated elsewhere", async () => {
    const ctx = ctxWith(REZAEI, { userMessageText: "برای رضایی نامه بنویس" });
    const first = await out(ctx, "رضایی");
    const token = first.r.choices!.find((c) => c.label.includes("رضایی صنعت"))!.token;
    const pick = consumePickToken(token, USER)!;
    expect(pick.id).toBe(id(2));
    // (what handleUpdate does on the tap)
    const { rememberResolved } = await import("./entityLedger");
    rememberResolved(USER, pick.type, pick.id, pick.name, 1, 1, "USER_PICKED");
    expect(getResolved(USER, "company", id(2))?.how).toBe("USER_PICKED");
    expect(() => requireResolved(USER, "company", id(2), { strict: true })).not.toThrow();
    const again = await out(ctxWith([...REZAEI, { id: id(4), name: "رضایی صنعت" }]), "رضایی صنعت");
    expect(again.data.tier).toBe("RESOLVED");
    expect(again.data.resolved?.id).toBe(id(2));
  });
});

describe("resolveEntity — plumbing", () => {
  it("asks the database for candidates of the right type, for the acting profile, with an optional company scope", async () => {
    const ctx = ctxWith([]);
    await resolveEntity(ctx, "contract", "قرارداد", { companyId: id(1) });
    expect(ctx.rpcCalls[0]).toMatchObject({ p_profile_id: USER, p_type: "contract", p_query: "قرارداد", p_company_id: id(1) });
  });
  it("turns a database authorisation failure into a plain Persian message", async () => {
    await expect(resolveEntity(ctxWith([], {}, "NOT_AUTHORIZED"), "contract", "x")).rejects.toThrow("دسترسی");
  });
  it("hides internal errors", async () => {
    await expect(resolveEntity(ctxWith([], {}, "relation foo does not exist"), "company", "x")).rejects.toThrow("جست‌وجو ناموفق");
  });
});

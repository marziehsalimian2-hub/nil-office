import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rememberResolved, getResolved, requireResolved, offerCandidates, wasOffered, createPickToken, consumePickToken,
  LEDGER_TTL_MS, PICK_TTL_MS, __resetLedger,
} from "./entityLedger";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => { __resetLedger(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("requireResolved — the write-time guard", () => {
  it("accepts an id that was resolved for THIS user", () => {
    rememberResolved(U1, "company", C1, "شرکت الف", 1, 0.5, "AUTO");
    expect(() => requireResolved(U1, "company", C1)).not.toThrow();
  });
  it("rejects a guessed / remembered / document-sourced id that was never resolved", () => {
    expect(() => requireResolved(U1, "company", C1)).toThrow(/SEARCH_COMPANY/);
    expect(() => requireResolved(U1, "contract", C1)).toThrow(/SEARCH_CONTRACT/);
    expect(() => requireResolved(U1, "project", C1)).toThrow(/SEARCH_PROJECT/);
  });
  it("is bound to the user and to the entity type", () => {
    rememberResolved(U1, "company", C1, "الف", 1, 1, "AUTO");
    expect(() => requireResolved(U2, "company", C1)).toThrow();
    expect(() => requireResolved(U1, "contract", C1)).toThrow();
  });
  it("an absent id (optional field) is not checked", () => {
    expect(() => requireResolved(U1, "company", undefined)).not.toThrow();
    expect(() => requireResolved(U1, "company", null, { strict: true })).not.toThrow();
  });
  it("expires after the TTL", () => {
    rememberResolved(U1, "company", C1, "الف", 1, 1, "AUTO");
    vi.setSystemTime(Date.now() + LEDGER_TTL_MS + 1000);
    expect(() => requireResolved(U1, "company", C1)).toThrow();
  });
});

describe("strict bar (financial / official actions)", () => {
  it("a convincing automatic match passes", () => {
    rememberResolved(U1, "company", C1, "شرکت الف", 1, 0.6, "AUTO");
    expect(() => requireResolved(U1, "company", C1, { strict: true })).not.toThrow();
  });
  it("a merely good automatic match fails and tells the model to ask the user", () => {
    rememberResolved(U1, "company", C1, "رضایی صنعت", 0.93, 0.5, "AUTO");
    expect(() => requireResolved(U1, "company", C1)).not.toThrow();                                   // fine for a task
    expect(() => requireResolved(U1, "company", C1, { strict: true })).toThrow(/رضایی صنعت/);        // not for money
  });
  it("a human pick always satisfies strict, and an automatic match never downgrades it", () => {
    rememberResolved(U1, "company", C1, "رضایی صنعت", 0.6, 0, "USER_PICKED");
    rememberResolved(U1, "company", C1, "رضایی صنعت", 0.93, 0.1, "AUTO");
    expect(getResolved(U1, "company", C1)?.how).toBe("USER_PICKED");
    expect(() => requireResolved(U1, "company", C1, { strict: true })).not.toThrow();
  });
});

describe("offers (ambiguous candidates)", () => {
  it("remembers which ids were offered, per user and type, and expires", () => {
    offerCandidates(U1, "company", [C1, C2]);
    expect(wasOffered(U1, "company", C1)).toBe(true);
    expect(wasOffered(U1, "company", "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toBe(false);
    expect(wasOffered(U2, "company", C1)).toBe(false);
    expect(wasOffered(U1, "contract", C1)).toBe(false);
    vi.setSystemTime(Date.now() + LEDGER_TTL_MS + 1000);
    expect(wasOffered(U1, "company", C1)).toBe(false);
  });
  it("being offered does NOT make an id resolved", () => {
    offerCandidates(U1, "company", [C1]);
    expect(() => requireResolved(U1, "company", C1)).toThrow();
  });
});

describe("pick tokens (Telegram buttons)", () => {
  it("are short, opaque, and carry neither the id nor the name", () => {
    const token = createPickToken(U1, "company", C1, "شرکت رضایی صنعت");
    expect(token).toMatch(/^[a-z0-9]{10}$/);
    expect(token).not.toContain(C1.slice(0, 8));
    expect(`pick:${token}`.length).toBeLessThanOrEqual(64);
  });
  it("redeem once, for the same user only", () => {
    const token = createPickToken(U1, "company", C1, "الف");
    expect(consumePickToken(token, U2)).toBeNull();                              // another user's tap
    expect(consumePickToken(token, U1)).toEqual({ type: "company", id: C1, name: "الف" });
    expect(consumePickToken(token, U1)).toBeNull();                              // replay / double tap
  });
  it("expire", () => {
    const token = createPickToken(U1, "company", C1, "الف");
    vi.setSystemTime(Date.now() + PICK_TTL_MS + 1000);
    expect(consumePickToken(token, U1)).toBeNull();
  });
  it("an unknown token is refused", () => {
    expect(consumePickToken("zzzzzzzzzz", U1)).toBeNull();
  });
});

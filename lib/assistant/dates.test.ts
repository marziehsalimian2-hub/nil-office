import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveDatePhrase } from "./dates";

// A fixed server clock: Wednesday 2026-09-23. The model never does calendar arithmetic — the server does.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const iso = (phrase: string) => {
  const r = resolveDatePhrase(phrase);
  return "iso" in r ? r.iso : `ERR:${r.error}`;
};

describe("resolveDatePhrase", () => {
  it("resolves the fixed relative phrases against the server clock", () => {
    expect(iso("امروز")).toBe("2026-09-23");
    expect(iso("فردا")).toBe("2026-09-24");
    expect(iso("پس فردا")).toBe("2026-09-25");
    expect(iso("۳ روز دیگر")).toBe("2026-09-26");
    expect(iso("هفته آینده")).toBe("2026-09-30");
    expect(iso("2 هفته دیگر")).toBe("2026-10-07");
  });

  it("weekday names mean the coming one, never today", () => {
    expect(iso("چهارشنبه")).toBe("2026-09-30"); // today is Wednesday -> next week
    expect(iso("شنبه")).toBe("2026-09-26");
    expect(iso("جمعه آینده")).toBe("2026-09-25");
  });

  it("passes absolute ISO and Jalali dates through (Persian digits accepted)", () => {
    expect(iso("2026-12-01")).toBe("2026-12-01");
    expect(iso("1405/07/01")).toBe("2026-09-23");
    expect(iso("۱۴۰۵/۰۷/۰۱")).toBe("2026-09-23");
  });

  it("never guesses an unrecognised phrase", () => {
    for (const phrase of ["اواخر ماه", "بعد از عید", "یه وقت دیگه", ""]) {
      expect(iso(phrase).startsWith("ERR:"), phrase).toBe(true);
    }
  });
});

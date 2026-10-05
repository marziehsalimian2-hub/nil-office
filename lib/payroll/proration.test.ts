import { describe, it, expect } from "vitest";
import { readProration, describeProration, personProration } from "./proration";

describe("readProration", () => {
  it("reads a well-formed trace", () => {
    expect(readProration({ employed_days: 10, period_days: 31 })).toEqual({ employed_days: 10, period_days: 31 });
  });
  it("refuses anything malformed instead of guessing", () => {
    expect(readProration(null)).toBeNull();
    expect(readProration("x")).toBeNull();
    expect(readProration({ employed_days: 32, period_days: 31 })).toBeNull();
    expect(readProration({ employed_days: -1, period_days: 31 })).toBeNull();
    expect(readProration({ employed_days: 1.5, period_days: 31 })).toBeNull();
    expect(readProration({ employed_days: 5, period_days: 0 })).toBeNull();
    expect(readProration({ employed_days: "a", period_days: 30 })).toBeNull();
  });
});

describe("describeProration", () => {
  it("shows the day counts in Persian digits", () => {
    expect(describeProration({ employed_days: 10, period_days: 31 })).toBe("متناسب با ۱۰ روز از ۳۱ روز");
  });
  it("is null without a trace", () => {
    expect(describeProration(null)).toBeNull();
    expect(describeProration(undefined)).toBeNull();
  });
});

describe("personProration", () => {
  it("only reports a ratio the engine really applied", () => {
    expect(personProration({ proration: { employed_days: 11, period_days: 31, applied: true } })).toEqual({ employed_days: 11, period_days: 31 });
    expect(personProration({ proration: { employed_days: 31, period_days: 31, applied: false } })).toBeNull();
    expect(personProration({ proration: { employed_days: 0, period_days: 31, applied: false } })).toBeNull();
  });
  it("is null for results calculated before Phase 9 (no trace)", () => {
    expect(personProration({ partial_period: true })).toBeNull();
    expect(personProration(null)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { jalaliMonthRange, jalaliMonthLabel, previousJalaliMonth, compareJalaliMonth } from "./period";

describe("jalaliMonthRange", () => {
  it("matches known calendar boundaries (both ends inclusive)", () => {
    expect(jalaliMonthRange(1405, 1)).toEqual({ start: "2026-03-21", end: "2026-04-20", days: 31 });
    expect(jalaliMonthRange(1405, 6)).toEqual({ start: "2026-08-23", end: "2026-09-22", days: 31 });
    expect(jalaliMonthRange(1405, 7)).toEqual({ start: "2026-09-23", end: "2026-10-22", days: 30 });
    expect(jalaliMonthRange(1405, 12)).toEqual({ start: "2027-02-20", end: "2027-03-20", days: 29 });
    expect(jalaliMonthRange(1403, 12)).toEqual({ start: "2025-02-19", end: "2025-03-20", days: 30 });
  });

  it("is continuous: end + 1 day = next month's start, for 1404–1409", () => {
    for (let jy = 1404; jy <= 1409; jy += 1) {
      for (let jm = 1; jm <= 12; jm += 1) {
        const cur = jalaliMonthRange(jy, jm);
        const nxt = jm === 12 ? jalaliMonthRange(jy + 1, 1) : jalaliMonthRange(jy, jm + 1);
        const [y, m, d] = cur.end.split("-").map(Number);
        const after = new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
        expect(after).toBe(nxt.start);
      }
    }
  });

  it("month lengths: 1-6 = 31, 7-11 = 30, 12 = 29 or 30", () => {
    for (let jy = 1404; jy <= 1409; jy += 1) {
      for (let jm = 1; jm <= 12; jm += 1) {
        const { days } = jalaliMonthRange(jy, jm);
        if (jm <= 6) expect(days).toBe(31);
        else if (jm <= 11) expect(days).toBe(30);
        else expect([29, 30]).toContain(days);
      }
    }
  });

  it("matches the far-future fixture period used by the SQL test (1450/01)", () => {
    expect(jalaliMonthRange(1450, 1)).toEqual({ start: "2071-03-21", end: "2071-04-20", days: 31 });
  });

  it("rejects an invalid month", () => {
    expect(() => jalaliMonthRange(1405, 0)).toThrow(RangeError);
    expect(() => jalaliMonthRange(1405, 13)).toThrow(RangeError);
  });
});

describe("month helpers", () => {
  it("labels, previous and compare", () => {
    expect(jalaliMonthLabel(1405, 1)).toBe("فروردین ۱۴۰۵");
    expect(previousJalaliMonth(1405, 1)).toEqual({ jy: 1404, jm: 12 });
    expect(previousJalaliMonth(1405, 7)).toEqual({ jy: 1405, jm: 6 });
    expect(compareJalaliMonth({ jy: 1404, jm: 12 }, { jy: 1405, jm: 1 })).toBeLessThan(0);
    expect(compareJalaliMonth({ jy: 1405, jm: 3 }, { jy: 1405, jm: 3 })).toBe(0);
  });
});

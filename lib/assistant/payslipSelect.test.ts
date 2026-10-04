import { describe, it, expect } from "vitest";
import { selectOwnPayslip, type OwnPayslipItem } from "./payslipSelect";

const item = (id: string, y: number, m: number, rev = 1, latest = true): OwnPayslipItem => ({
  id, revision: rev, payment_state: "PAID", issued_at: "2026-01-01T00:00:00Z", jalali_year: y, jalali_month: m, currency: "IRR", is_latest: latest,
});

const ITEMS = [item("p-07-r2", 1405, 7, 2, true), item("p-07-r1", 1405, 7, 1, false), item("p-06", 1405, 6), item("p-05", 1405, 5)];
const TODAY = { jy: 1405, jm: 7 };

describe("selectOwnPayslip", () => {
  it("returns the latest payslip when no period is given", () => {
    const r = selectOwnPayslip(ITEMS, {}, TODAY);
    expect(r.ok && r.item.id).toBe("p-07-r2");
    expect(r.ok && r.label).toContain("مهر");
  });
  it("this_month / prev_month resolve against the server's Jalali month", () => {
    expect(selectOwnPayslip(ITEMS, { period: "this_month" }, TODAY)).toMatchObject({ ok: true, item: { id: "p-07-r2" } });
    expect(selectOwnPayslip(ITEMS, { period: "prev_month" }, TODAY)).toMatchObject({ ok: true, item: { id: "p-06" } });
  });
  it("prev_month wraps across the year boundary", () => {
    const items = [item("old", 1404, 12)];
    expect(selectOwnPayslip(items, { period: "prev_month" }, { jy: 1405, jm: 1 })).toMatchObject({ ok: true, item: { id: "old" } });
  });
  it("a specific month picks that month's latest revision, never an older one", () => {
    expect(selectOwnPayslip(ITEMS, { jalali_year: 1405, jalali_month: 7 }, TODAY)).toMatchObject({ ok: true, item: { id: "p-07-r2", revision: 2 } });
    expect(selectOwnPayslip(ITEMS, { jalali_year: 1405, jalali_month: 5 }, TODAY)).toMatchObject({ ok: true, item: { id: "p-05" } });
  });
  it("never substitutes another month when the requested one is missing", () => {
    const r = selectOwnPayslip(ITEMS, { jalali_year: 1405, jalali_month: 3 }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("خرداد");
  });
  it("needs both year and month for an explicit month", () => {
    expect(selectOwnPayslip(ITEMS, { jalali_month: 5 }, TODAY).ok).toBe(false);
    expect(selectOwnPayslip(ITEMS, { jalali_year: 1405 }, TODAY).ok).toBe(false);
  });
  it("reports clearly when no payslip exists at all", () => {
    expect(selectOwnPayslip([], {}, TODAY).ok).toBe(false);
    expect(selectOwnPayslip([item("x", 1405, 7, 1, false)], {}, TODAY).ok).toBe(false);
  });
});

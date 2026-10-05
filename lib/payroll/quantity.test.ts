import { describe, it, expect } from "vitest";
import { describeQuantityVersion, describeQuantityLine, roundRate } from "./quantity";

describe("describeQuantityVersion", () => {
  it("is null for every other method", () => {
    expect(describeQuantityVersion({ calculation_method: "FIXED" })).toBeNull();
    expect(describeQuantityVersion({ calculation_method: "PERCENTAGE" })).toBeNull();
  });
  it("describes a wage-fraction component with numbers on the component", () => {
    const t = describeQuantityVersion({ calculation_method: "QUANTITY_X_RATE", quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: 220, rate_multiplier: 1.4 })!;
    expect(t).toContain("اضافه‌کاری");
    expect(t).toContain("۲۲۰");
    expect(t).toContain("۱٫۴");
    expect(t).toContain("دستمزد");
  });
  it("shows the rule key when a parameter comes from an approved rule", () => {
    const t = describeQuantityVersion({ calculation_method: "QUANTITY_X_RATE", quantity_source: "ABSENCE_DAYS", rate_mode: "WAGE_FRACTION", divisor_rule_key: "days_basis", multiplier_rule_key: "abs_mult" })!;
    expect(t).toContain("«days_basis»");
    expect(t).toContain("«abs_mult»");
  });
  it("describes a per-unit rate exactly, with its currency and unit", () => {
    const t = describeQuantityVersion({ calculation_method: "QUANTITY_X_RATE", quantity_source: "MISSION_DAYS", rate_mode: "PER_UNIT", fixed_amount: "500000", currency: "IRR" })!;
    expect(t).toContain("۵۰۰٬۰۰۰");
    expect(t).toContain("ریال");
    expect(t).toContain("روز");
  });
  it("flags a legacy parameter-less definition", () => {
    expect(describeQuantityVersion({ calculation_method: "QUANTITY_X_RATE" })).toContain("قدیمی");
  });
});

describe("describeQuantityLine", () => {
  it("shows quantity, unit and a short unit rate", () => {
    expect(describeQuantityLine({ quantity: "10.0000", unit: "HOURS", unit_rate: "190909.090909" }, "IRR")).toBe("۱۰ ساعت × ۱۹۰٬۹۰۹٫۰۹ ریال");
  });
  it("works without a rate and returns null for a non-quantity line", () => {
    expect(describeQuantityLine({ quantity: "2.5", unit: "DAYS" })).toBe("۲٫۵ روز");
    expect(describeQuantityLine({})).toBeNull();
    expect(describeQuantityLine({ quantity: null, unit: null })).toBeNull();
  });
  it("roundRate truncates for display only and never uses floats", () => {
    expect(roundRate("190909.090909")).toBe("190909.09");
    expect(roundRate("210000.000000")).toBe("210000");
    expect(roundRate("12345678901234.999999")).toBe("12345678901234.99");
    expect(roundRate("abc")).toBe("abc");
  });
});

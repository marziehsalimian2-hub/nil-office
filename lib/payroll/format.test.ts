import { describe, it, expect } from "vitest";
import { formatExactAmount } from "./format";

describe("formatExactAmount", () => {
  it("groups and trims trailing zeros (Persian digits/separators)", () => {
    expect(formatExactAmount("9020501.0000")).toBe("۹٬۰۲۰٬۵۰۱");
    expect(formatExactAmount("987654321.1234")).toBe("۹۸۷٬۶۵۴٬۳۲۱٫۱۲۳۴");
    expect(formatExactAmount("1000.5000")).toBe("۱٬۰۰۰٫۵");
  });
  it("keeps every digit beyond float precision", () => {
    expect(formatExactAmount("12345678901234567.5")).toBe("۱۲٬۳۴۵٬۶۷۸٬۹۰۱٬۲۳۴٬۵۶۷٫۵");
  });
  it("handles negatives and zero", () => {
    expect(formatExactAmount("-1000000.0000")).toBe("-۱٬۰۰۰٬۰۰۰");
    expect(formatExactAmount("-0.0000")).toBe("۰");
    expect(formatExactAmount("0")).toBe("۰");
  });
  it("appends the currency label and rejects garbage", () => {
    expect(formatExactAmount("5", "IRR")).toContain("۵ ");
    expect(formatExactAmount("abc")).toBe("—");
    expect(formatExactAmount(null)).toBe("—");
    expect(formatExactAmount("1e5")).toBe("—");
  });
});

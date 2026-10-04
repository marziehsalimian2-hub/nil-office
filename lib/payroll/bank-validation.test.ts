import { describe, it, expect } from "vitest";
import { ibanChecksumOk, isValidIranSheba, isValidCardNumber } from "./bank-validation";

function buildIranIban(bban22: string): string {
  // check digits = 98 - ((BBAN + "IR00") with letters as numbers, I=18 R=27) mod 97
  const digits = (bban22 + "1827" + "00").split("").join("");
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return "IR" + String(98 - r).padStart(2, "0") + bban22;
}

describe("ibanChecksumOk", () => {
  it("accepts a known-valid IBAN and rejects a one-digit change", () => {
    expect(ibanChecksumOk("GB82WEST12345698765432")).toBe(true);
    expect(ibanChecksumOk("GB82WEST12345698765433")).toBe(false);
  });
});

describe("isValidIranSheba", () => {
  const good = buildIranIban("0629600000001003242000"); // IR + 2 check digits + 22-digit BBAN = 26 chars
  it("accepts a constructed valid Sheba and rejects tampering/length/prefix", () => {
    expect(isValidIranSheba(good)).toBe(true);
    const tampered = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    expect(isValidIranSheba(tampered)).toBe(false);
    expect(isValidIranSheba(good.slice(0, -1))).toBe(false);
    expect(isValidIranSheba("XX" + good.slice(2))).toBe(false);
  });
});

describe("isValidCardNumber", () => {
  it("applies the Luhn check", () => {
    expect(isValidCardNumber("4111111111111111")).toBe(true);
    expect(isValidCardNumber("4111111111111112")).toBe(false);
    expect(isValidCardNumber("411111111111111")).toBe(false);
  });
});

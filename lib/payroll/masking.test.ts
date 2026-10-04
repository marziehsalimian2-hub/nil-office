import { describe, it, expect } from "vitest";
import { maskIban, maskAccount, maskCard } from "./masking";

describe("masking", () => {
  it("keeps only the last 4 characters (and the IR prefix)", () => {
    expect(maskCard("4111111111111111")).toBe("••••••••••••1111");
    expect(maskAccount("1234567890")).toBe("••••••7890");
    expect(maskIban("IR062960000000100324200001")?.startsWith("IR")).toBe(true);
    expect(maskIban("IR062960000000100324200001")?.endsWith("0001")).toBe(true);
    expect(maskIban(null)).toBeNull();
  });
});

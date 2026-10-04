import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ERROR_MESSAGES } from "./enums";

// persianError() matches with message.includes(key) in insertion order, so a key that contains an EARLIER key is shadowed.
// These two collisions are legacy (COMPANY_NOT_FOUND / BANK_ACCOUNT_NOT_FOUND are hijacked by NOT_FOUND).
const LEGACY = new Set(["COMPANY_NOT_FOUND", "BANK_ACCOUNT_NOT_FOUND"]);

describe("ERROR_MESSAGES", () => {
  it("has no new key shadowed by an earlier key", () => {
    const keys = Object.keys(ERROR_MESSAGES);
    const shadowed = keys.filter((k, i) => !LEGACY.has(k) && keys.slice(0, i).some((e) => e !== k && k.includes(e)));
    expect(shadowed).toEqual([]);
  });

  it("covers every PAYROLL_* code the payroll migrations raise", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => /^01(1[89]|2\d)_/.test(f));
    const raised = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/raise exception '(PAYROLL_[A-Z_]+)'/g)) raised.add(m[1]);
    }
    expect(raised.size).toBeGreaterThan(15);
    const missing = [...raised].filter((c) => !(c in ERROR_MESSAGES));
    // PAYROLL_NO_DELETE / PAYROLL_VERSION_* come from earlier phases and are already mapped; anything else must be too
    expect(missing).toEqual([]);
  });
});

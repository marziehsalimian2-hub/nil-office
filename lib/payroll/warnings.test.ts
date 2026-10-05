import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAYROLL_WARNING_META, KNOWN_WARNING_CODES, describeWarning, blockingCount } from "./warnings";

// Every code literal the engine can emit (0139 — PAYROLL_ENGINE_3, which restates 0121 / 0138) — extracted from the SQL so the two cannot drift apart.
function sqlCodes(): string[] {
  const src = readFileSync(join(process.cwd(), "supabase", "migrations", "0139_payroll_proration.sql"), "utf8");
  const re = /'(CRITICAL|WARNING|INFO)',\s*'([A-Z][A-Z0-9_]+)'/g;
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[2]);
  // the rule resolver statuses are passed through as codes (_payroll_rule_for_period, 0120)
  for (const c of ["RULE_MISSING", "RULE_AMBIGUOUS", "RULE_CHANGES_IN_PERIOD"]) out.add(c);
  return [...out];
}

describe("payroll warnings", () => {
  it("has a Persian message for every code the SQL engine can emit", () => {
    const codes = sqlCodes();
    expect(codes.length).toBeGreaterThanOrEqual(20);
    for (const c of codes) expect(KNOWN_WARNING_CODES, `missing meta for ${c}`).toContain(c);
  });

  it("25 codes: 16 critical, 8 warning, 1 info", () => {
    const sev = (s: string) => Object.values(PAYROLL_WARNING_META).filter((m) => m.severity === s).length;
    expect(KNOWN_WARNING_CODES.length).toBe(25);
    expect([sev("CRITICAL"), sev("WARNING"), sev("INFO")]).toEqual([16, 8, 1]);
  });

  it("messages carry no digits and no currency (codes can never leak amounts)", () => {
    for (const [code, meta] of Object.entries(PAYROLL_WARNING_META)) {
      const text = meta.text({ component_code: "COMP_X", rule_key: "rule_key_x" });
      const stripped = text.replace(/COMP_X|rule_key_x/g, "");
      expect(/[0-9۰-۹]/.test(stripped), `digits in ${code}`).toBe(false);
      expect(/ریال|تومان|دلار|IRR|USD/.test(text), `currency in ${code}`).toBe(false);
    }
  });

  it("describes unknown codes safely and counts blockers", () => {
    expect(describeWarning({ severity: "INFO", code: "NOPE" })).toContain("NOPE");
    expect(blockingCount([{ severity: "CRITICAL" }, { severity: "WARNING" }, { severity: "CRITICAL" }])).toBe(2);
  });
});

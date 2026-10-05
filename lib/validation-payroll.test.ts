import { describe, it, expect } from "vitest";
import { salaryComponentCreateSchema, salaryComponentVersionSchema } from "./validation-payroll";
import { QUANTITY_SOURCE, quantityUnitOf, DEFERRED_CALCULATION_METHODS } from "./enums";

const base = { code: "ot_x", component_type: "EARNING", name_fa: "اضافه‌کاری", effective_from: "2026-01-01" };
const qty = (over: Record<string, string>) => ({ ...base, calculation_method: "QUANTITY_X_RATE", ...over });
const issue = (input: unknown) => {
  const r = salaryComponentCreateSchema.safeParse(input);
  return r.success ? null : r.error.issues[0]?.message ?? "error";
};

describe("QUANTITY_X_RATE component validation (Phase 8)", () => {
  it("accepts a wage-fraction component with numbers on the component", () => {
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220", rate_multiplier: "1.4" }))).toBeNull();
  });
  it("accepts a wage-fraction component whose divisor and multiplier come from approved rules", () => {
    expect(issue(qty({ quantity_source: "ABSENCE_DAYS", rate_mode: "WAGE_FRACTION", divisor_rule_key: "days_basis", multiplier_rule_key: "abs_mult" }))).toBeNull();
  });
  it("accepts a mix: divisor from a rule, multiplier on the component", () => {
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", divisor_rule_key: "hours_basis", rate_multiplier: "1.4" }))).toBeNull();
  });
  it("accepts a per-unit rate with its currency", () => {
    expect(issue(qty({ quantity_source: "MISSION_DAYS", rate_mode: "PER_UNIT", fixed_amount: "500000", currency: "IRR" }))).toBeNull();
  });

  it("requires the quantity source and the rate mode", () => {
    expect(issue(qty({ rate_mode: "PER_UNIT", fixed_amount: "1", currency: "IRR" }))).toContain("منبع مقدار");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS" }))).toContain("نحوهٔ تعیین نرخ");
  });
  it("refuses a divisor (or multiplier) given two ways or not at all — never a silent default", () => {
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220", divisor_rule_key: "k_one", rate_multiplier: "1.4" }))).toContain("مبنای ماه");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", rate_multiplier: "1.4" }))).toContain("مبنای ماه");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220" }))).toContain("ضریب");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220", rate_multiplier: "1.4", multiplier_rule_key: "mult_k" }))).toContain("ضریب");
  });
  it("refuses an out-of-range divisor or multiplier", () => {
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "0", rate_multiplier: "1" }))).toContain("مبنای ماه");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "745", rate_multiplier: "1" }))).toContain("۷۴۴");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220", rate_multiplier: "11" }))).toContain("۱۰");
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "abc", rate_multiplier: "1" }))).not.toBeNull();
  });
  it("a per-unit component needs a rate and a currency, and no divisor / multiplier", () => {
    expect(issue(qty({ quantity_source: "MISSION_DAYS", rate_mode: "PER_UNIT", currency: "IRR" }))).toContain("نرخ هر واحد");
    expect(issue(qty({ quantity_source: "MISSION_DAYS", rate_mode: "PER_UNIT", fixed_amount: "500000" }))).toContain("واحد پول");
    expect(issue(qty({ quantity_source: "MISSION_DAYS", rate_mode: "PER_UNIT", fixed_amount: "500000", currency: "IRR", unit_divisor: "30" }))).toContain("مبنای ماه و ضریب");
  });
  it("a wage-fraction component cannot also carry a fixed amount", () => {
    expect(issue(qty({ quantity_source: "OVERTIME_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220", rate_multiplier: "1.4", fixed_amount: "5", currency: "IRR" }))).toContain("مبلغ ثابت");
  });
  it("the quantity parameters are refused on every other method", () => {
    for (const method of ["FIXED", "PERCENTAGE", "MANUAL_INPUT", "FORMULA"]) {
      const extra = method === "FIXED" ? { fixed_amount: "1", currency: "IRR" } : method === "PERCENTAGE" ? { percentage: "7", percentage_basis: "BASE_SALARY" } : {};
      expect(issue({ ...base, calculation_method: method, ...extra, quantity_source: "OVERTIME_HOURS" }), method).toContain("فقط برای همین روش");
    }
  });
  it("an unknown quantity source is refused", () => {
    expect(issue(qty({ quantity_source: "FOO", rate_mode: "PER_UNIT", fixed_amount: "1", currency: "IRR" }))).not.toBeNull();
  });
  it("the version schema applies the same rules", () => {
    const ok = salaryComponentVersionSchema.safeParse({ component_id: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9", name_fa: "x", effective_from: "2026-01-01", calculation_method: "QUANTITY_X_RATE", quantity_source: "ABSENCE_HOURS", rate_mode: "WAGE_FRACTION", unit_divisor: "220", rate_multiplier: "1" });
    expect(ok.success).toBe(true);
    const bad = salaryComponentVersionSchema.safeParse({ component_id: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9", name_fa: "x", effective_from: "2026-01-01", calculation_method: "QUANTITY_X_RATE", quantity_source: "ABSENCE_HOURS", rate_mode: "WAGE_FRACTION" });
    expect(bad.success).toBe(false);
  });
});

describe("quantity enums", () => {
  it("the unit follows the source name", () => {
    for (const s of QUANTITY_SOURCE) expect(quantityUnitOf(s)).toBe(s.endsWith("_HOURS") ? "HOURS" : "DAYS");
    expect(quantityUnitOf("OVERTIME_HOURS")).toBe("HOURS");
    expect(quantityUnitOf("ABSENCE_DAYS")).toBe("DAYS");
  });
  it("only FORMULA is still deferred — QUANTITY_X_RATE is evaluated by PAYROLL_ENGINE_2", () => {
    expect(DEFERRED_CALCULATION_METHODS).toEqual(["FORMULA"]);
  });
  it("the quantity sources match the work-data columns and the SQL CHECK", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0137_payroll_quantity_columns.sql"), "utf8");
    for (const s of QUANTITY_SOURCE) expect(sql, s).toContain(`'${s}'`);
    const engine = readFileSync(join(process.cwd(), "supabase", "migrations", "0138_payroll_engine_2.sql"), "utf8");
    for (const s of QUANTITY_SOURCE) expect(engine, s).toContain(`'${s}'`);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORTS, reportByKey, reportsOf } from "./definitions";
import { parseYm, rpcArgs, missingFilters } from "./params";
import { displayCell, csvCells, csvHeaders, csvRows, withPeriodLabel } from "./format";
import { toCsv } from "@/lib/csv";

describe("report registry", () => {
  it("has the 14 reports of spec §57 (3 HR + 11 payroll) with unique keys", () => {
    expect(REPORTS.length).toBe(14);
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(14);
    expect(reportsOf("hr").length).toBe(3);
    expect(reportsOf("payroll").length).toBe(11);
    for (const r of reportsOf("hr")) expect(r.key.startsWith("hr_")).toBe(true);        // record_report_export routes by this prefix
    for (const r of reportsOf("payroll")) expect(r.key.startsWith("hr_")).toBe(false);
    for (const r of REPORTS) expect(r.key).toMatch(/^[a-z][a-z0-9_]{2,63}$/);            // same pattern record_report_export enforces
  });

  it("column keys are unique per report", () => {
    for (const r of REPORTS) {
      const keys = r.columns.map((c) => c.key);
      expect(new Set(keys).size, r.key).toBe(keys.length);
    }
  });

  it("every payroll report with money columns also exposes the currency (currencies are never summed)", () => {
    for (const r of reportsOf("payroll")) {
      const hasMoney = r.columns.some((c) => c.kind === "money");
      if (hasMoney) expect(r.columns.some((c) => c.key === "currency"), `${r.key} needs a currency column`).toBe(true);
      if (r.totalsColumns?.some((c) => c.kind === "money")) expect(r.totalsColumns.some((c) => c.key === "currency"), `${r.key} totals`).toBe(true);
    }
  });

  it("HR reports contain no money columns (salary never reaches HR)", () => {
    for (const r of reportsOf("hr")) {
      expect(r.columns.some((c) => c.kind === "money"), r.key).toBe(false);
      expect(r.source.kind).toBe("table");
    }
  });

  it("every RPC behind a payroll report exists in migration 0132 and is gated by has_payroll_access()", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0132_payroll_reports.sql"), "utf8");
    const rpcs = new Set(REPORTS.filter((r) => r.source.kind === "rpc").map((r) => (r.source as { name: string }).name));
    expect(rpcs.size).toBeGreaterThanOrEqual(8);
    for (const name of rpcs) {
      const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\s*end; \\$\\$;`);
      const m = re.exec(sql);
      expect(m, `missing function ${name}`).not.toBeNull();
      expect(m![0], `${name} must check has_payroll_access() first`).toContain("has_payroll_access()");
    }
  });
});

describe("params", () => {
  it("parses Jalali year-month filters and rejects garbage", () => {
    expect(parseYm("1405-07")).toEqual({ year: 1405, month: 7 });
    expect(parseYm("1405-7")).toEqual({ year: 1405, month: 7 });
    expect(parseYm("1405-13")).toBeNull();
    expect(parseYm("abc")).toBeNull();
    expect(parseYm(undefined)).toBeNull();
  });

  it("maps filters to RPC arguments (uuid-validated, never trusting raw input)", () => {
    const by = reportByKey("payroll_by_period")!;
    expect(rpcArgs(by, { from: "1405-01", to: "1405-12", currency: "IRR" })).toEqual({
      p_from_year: 1405, p_from_month: 1, p_to_year: 1405, p_to_month: 12, p_currency: "IRR",
    });
    const reg = reportByKey("payroll_register")!;
    expect(rpcArgs(reg, { period: "not-a-uuid" })).toEqual({ p_period_id: null, p_currency: null });
    expect(rpcArgs(reg, { period: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9" }).p_period_id).toBe("0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9");
    expect(rpcArgs(reportByKey("payroll_outstanding")!, {})).toMatchObject({ p_only_outstanding: true });
  });

  it("reports with required filters refuse to run until they are chosen", () => {
    expect(missingFilters(reportByKey("payroll_register")!, {})).toEqual(["period"]);
    expect(missingFilters(reportByKey("payroll_by_personnel")!, {})).toEqual(["personnel"]);
    expect(missingFilters(reportByKey("payroll_by_period")!, {})).toEqual([]);
  });
});

describe("formatting + CSV mapping", () => {
  const money = reportByKey("payroll_register")!.columns.find((c) => c.key === "net")!;
  const date = reportByKey("hr_personnel_register")!.columns.find((c) => c.key === "hire_date")!;
  const flags = reportByKey("payroll_reconciliation")!.columns.find((c) => c.key === "flags")!;
  const state = reportByKey("payroll_register")!.columns.find((c) => c.key === "payment_state")!;

  it("shows money exactly (string grouping) and CSV keeps the raw decimal", () => {
    expect(displayCell(money, "10230000.0000")).toBe("۱۰٬۲۳۰٬۰۰۰");
    expect(displayCell(money, "12345678901234567.5")).toBe("۱۲٬۳۴۵٬۶۷۸٬۹۰۱٬۲۳۴٬۵۶۷٫۵");
    expect(csvCells(money, "10230000.0000")).toEqual([{ raw: "10230000.0000" }]);
    expect(csvCells(money, "-5.0000")).toEqual([{ raw: "-5.0000" }]);        // negative money is NOT formula-guarded
    expect(displayCell(money, null)).toBe("—");
  });

  it("dates export as ISO + Jalali", () => {
    expect(csvHeaders([date])).toEqual(["تاریخ استخدام (میلادی)", "تاریخ استخدام (شمسی)"]);
    expect(csvCells(date, "2026-03-21")).toEqual([{ raw: "2026-03-21" }, { raw: "1405/01/01" }]);
  });

  it("enums, flags and booleans use Persian labels", () => {
    expect(displayCell(state, "PARTIALLY_PAID")).toBe("پرداخت ناقص");
    expect(displayCell(flags, ["UNPAID", "OVERPAID"])).toContain("هنوز چیزی پرداخت نشده");
    expect(csvCells(flags, ["UNPAID"])).toEqual(["هنوز چیزی پرداخت نشده"]);
    expect(displayCell({ key: "x", label: "x", kind: "bool" }, true)).toBe("بله");
  });

  it("builds a complete CSV (headers + rows) and guards user text", () => {
    const def = reportByKey("hr_personnel_register")!;
    const out = toCsv(csvHeaders(def.columns), csvRows(def.columns, [
      { personnel_number: "EMP-1405-0001", name: "=EVIL()", job_title: "کارشناس", hire_date: "2026-03-21", employment_status: "ACTIVE" },
    ]));
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain("'=EVIL()");
    expect(out).toContain("1405/01/01");
    expect(out.split("\r\n")[0]).toContain("شمارهٔ پرسنلی");
  });

  it("adds a human period label from jalali_year / jalali_month", () => {
    expect(withPeriodLabel({ jalali_year: 1405, jalali_month: 7 }).period_label).toBe("مهر ۱۴۰۵");
    expect(withPeriodLabel({ x: 1 })).toEqual({ x: 1 });
  });
});

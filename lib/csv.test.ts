import { describe, it, expect } from "vitest";
import { csvCell, toCsv, CSV_BOM } from "./csv";

describe("csv", () => {
  it("starts with a BOM, uses CRLF and ends with a newline", () => {
    const out = toCsv(["نام", "مبلغ"], [["الف", { raw: "10230000.0000" }]]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out).toBe(`${CSV_BOM}نام,مبلغ\r\nالف,10230000.0000\r\n`);
  });

  it("quotes commas, quotes, newlines and surrounding spaces", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("guards TEXT cells against spreadsheet formulas but leaves raw numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell({ raw: "-1000.5000" })).toBe("-1000.5000");   // money/ints are exact and verbatim
    expect(csvCell(-3)).toBe("-3");
  });

  it("renders null/undefined as empty, booleans in Persian, non-finite numbers as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("بله");
    expect(csvCell(false)).toBe("خیر");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("keeps Persian text and does not touch ordinary text", () => {
    expect(csvCell("سید سامان حسینی رضوانی")).toBe("سید سامان حسینی رضوانی");
    expect(csvCell("EMP-1405-0001")).toBe("EMP-1405-0001");
  });
});

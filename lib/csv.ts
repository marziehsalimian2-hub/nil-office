/**
 * Minimal, dependency-free CSV writer for report exports (pure — vitest-testable).
 *  - UTF-8 BOM so Excel opens Persian text correctly; CRLF line endings; RFC-4180 quoting.
 *  - Spreadsheet formula-injection guard: TEXT cells beginning with = + - @ (or tab/CR) get a leading apostrophe. Names and notes come
 *    from users, so an exported name like «=HYPERLINK(...)» must never become a live formula.
 *  - Numbers / money / dates are passed as `{ raw }` and are written verbatim (no guard, so "-1000.5" stays a number).
 */
export type CsvValue = string | number | boolean | null | undefined | { raw: string };

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvValue): string {
  let s: string;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") s = v.raw;
  else if (typeof v === "number") s = Number.isFinite(v) ? String(v) : "";
  else if (typeof v === "boolean") s = v ? "بله" : "خیر";
  else s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_BOM = "﻿";

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map((h) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

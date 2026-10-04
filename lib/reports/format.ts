import { formatExactAmount } from "@/lib/payroll/format";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import type { CsvValue } from "@/lib/csv";
import type { ReportCol } from "@/lib/reports/definitions";

export type ReportRow = Record<string, unknown>;

const asStr = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Adds the human period label (فروردین ۱۴۰۵) next to jalali_year / jalali_month so the registry can show one «دوره» column. */
export function withPeriodLabel(row: ReportRow): ReportRow {
  const y = row.jalali_year;
  const m = row.jalali_month;
  if (typeof y === "number" && typeof m === "number") return { ...row, period_label: jalaliMonthLabel(y, m) };
  return row;
}

/** On-screen text for a cell. Money stays an exact string (string-only grouping). */
export function displayCell(col: ReportCol, value: unknown): string {
  const s = asStr(value);
  switch (col.kind) {
    case "money": return s === null ? "—" : formatExactAmount(s);
    case "int": return s === null ? "—" : toFaDigits(s);
    case "date": return s === null ? "—" : formatJalali(s);
    case "bool": return value === true ? "بله" : value === false ? "خیر" : "—";
    case "enum": return s === null ? "—" : (col.labels?.[s] ?? s);
    case "flags": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return list.length === 0 ? "—" : list.map((f) => col.labels?.[f] ?? f).join("؛ ");
    }
    default: return s ?? "—";
  }
}

/** CSV cells for a column (dates yield TWO cells: ISO + Jalali). Money/int/date are raw so the guard never touches them. */
export function csvCells(col: ReportCol, value: unknown): CsvValue[] {
  const s = asStr(value);
  switch (col.kind) {
    case "money":
    case "int": return [s === null ? null : { raw: s }];
    case "date": return [s === null ? null : { raw: s.slice(0, 10) }, s === null ? null : { raw: formatJalali(s, false) }];
    case "bool": return [typeof value === "boolean" ? value : null];
    case "enum": return [s === null ? null : (col.labels?.[s] ?? s)];
    case "flags": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return [list.map((f) => col.labels?.[f] ?? f).join(" | ")];
    }
    default: return [s];
  }
}

export function csvHeaders(cols: ReportCol[]): string[] {
  return cols.flatMap((c) => (c.kind === "date" ? [`${c.label} (میلادی)`, `${c.label} (شمسی)`] : [c.label]));
}

export function csvRows(cols: ReportCol[], rows: ReportRow[]): CsvValue[][] {
  return rows.map((r) => cols.flatMap((c) => csvCells(c, r[c.key])));
}

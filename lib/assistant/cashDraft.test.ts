import { describe, it, expect } from "vitest";
import {
  parseAmountText, normalizeDigits, checkDraftDate, pickFiscalYear, decideDuplicates, describeDuplicate, buildCashPreview,
  missingAccountingFields, cleanText, sha256Hex, type DuplicateRow, type PreviewInput,
} from "./cashDraft";

describe("parseAmountText — exact, never a float, never a guess", () => {
  it("accepts plain, separated and Persian/Arabic-digit amounts and returns a canonical string", () => {
    expect(parseAmountText("100000000")).toEqual({ ok: true, value: "100000000" });
    expect(parseAmountText("100,000,000")).toEqual({ ok: true, value: "100000000" });
    expect(parseAmountText("۱۰۰٬۰۰۰٬۰۰۰")).toEqual({ ok: true, value: "100000000" });
    expect(parseAmountText("١٢٣٤")).toEqual({ ok: true, value: "1234" });
    expect(parseAmountText(" 2 500 000 ")).toEqual({ ok: true, value: "2500000" });
  });
  it("keeps every digit of a large amount (no float rounding)", () => {
    expect(parseAmountText("12345678901234567")).toEqual({ ok: false, error: expect.stringContaining("بزرگ") }); // 17 digits refused
    expect(parseAmountText("1234567890123456")).toEqual({ ok: true, value: "1234567890123456" });
    expect(parseAmountText("9007199254740993")).toEqual({ ok: true, value: "9007199254740993" });             // > 2^53, intact
  });
  it("accepts a short decimal part and trims trailing zeros / leading zeros", () => {
    expect(parseAmountText("12.5")).toEqual({ ok: true, value: "12.5" });
    expect(parseAmountText("12.50")).toEqual({ ok: true, value: "12.5" });
    expect(parseAmountText("0012")).toEqual({ ok: true, value: "12" });
    expect(parseAmountText("0.5")).toEqual({ ok: true, value: "0.5" });
  });
  it("refuses ambiguous formats so the model has to ask", () => {
    for (const bad of ["1.500.000", "1.500", "صد میلیون", "100 million", "100M", "-5", "+5", "1e6", "", "   ", "12.", ".5", "12.12345"]) {
      expect(parseAmountText(bad).ok, bad).toBe(false);
    }
  });
  it("refuses zero", () => {
    for (const z of ["0", "000", "0.0", "0.00"]) expect(parseAmountText(z).ok, z).toBe(false);
  });
  it("normalizeDigits maps both digit sets", () => {
    expect(normalizeDigits("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩")).toBe("01234567890123456789");
  });
});

describe("checkDraftDate", () => {
  const today = "2026-10-04";
  it("accepts today, yesterday and tomorrow (time-zone slack)", () => {
    expect(checkDraftDate("2026-10-04", today)).toEqual({ ok: true });
    expect(checkDraftDate("2026-10-03", today)).toEqual({ ok: true });
    expect(checkDraftDate("2026-10-05", today)).toEqual({ ok: true });
  });
  it("refuses a date further in the future (a misread digit)", () => {
    expect(checkDraftDate("2026-10-06", today).ok).toBe(false);
    expect(checkDraftDate("2027-01-01", today).ok).toBe(false);
  });
  it("warns about a very old date but allows it", () => {
    const r = checkDraftDate("2026-05-01", today);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toContain("90");
  });
  it("refuses garbage", () => {
    expect(checkDraftDate("1405/07/01", today).ok).toBe(false);
    expect(checkDraftDate("2026-13-40", today).ok).toBe(false);
  });
});

describe("pickFiscalYear — one open year or nothing", () => {
  const fy = (id: string, s: string, e: string, status = "OPEN") => ({ id, start_date: s, end_date: e, status });
  it("picks the single open year containing the date", () => {
    expect(pickFiscalYear([fy("a", "2026-03-21", "2027-03-20"), fy("b", "2025-03-21", "2026-03-20", "CLOSED")], "2026-10-04")).toBe("a");
  });
  it("never guesses when none or several match", () => {
    expect(pickFiscalYear([fy("a", "2026-03-21", "2027-03-20")], "2028-01-01")).toBeNull();
    expect(pickFiscalYear([fy("a", "2026-01-01", "2026-12-31"), fy("b", "2026-06-01", "2027-05-31")], "2026-10-04")).toBeNull();
    expect(pickFiscalYear([fy("a", "2026-03-21", "2027-03-20", "CLOSED")], "2026-10-04")).toBeNull();
  });
});

const row = (over: Partial<DuplicateRow> = {}): DuplicateRow => ({
  kind: "RECEIPT", id: "r1", status: "DRAFT", display_number: null, date: "2026-10-01", amount: "100000000", currency: "IRR",
  counterparty: "شرکت الف", reason: "SAME_REFERENCE", ...over,
});

describe("duplicate decision", () => {
  it("a HARD duplicate blocks the proposal and tells the model to ask the user", () => {
    const d = decideDuplicates({ hard: [row()], soft: [] }, false);
    expect(d.block).toBe(true);
    if (d.block) {
      expect(d.message).toContain("تکراری");
      expect(d.message).toContain("confirmed_not_duplicate");
      expect(d.message).toContain("شرکت الف");
    }
  });
  it("after the user says it is not a duplicate the proposal goes ahead — with the warning inside the preview", () => {
    const d = decideDuplicates({ hard: [row({ reason: "SAME_FILE" })], soft: [] }, true);
    expect(d.block).toBe(false);
    if (!d.block) {
      expect(d.warnings).toHaveLength(1);
      expect(d.warnings[0]).toContain("همان فایل");
      expect(d.warnings[0]).toContain("تکراری نیست");
    }
  });
  it("SOFT matches only warn", () => {
    const d = decideDuplicates({ hard: [], soft: [row({ reason: "SAME_DAY_AMOUNT", status: "POSTED", display_number: "REC-1405-0001" })] }, false);
    expect(d.block).toBe(false);
    if (!d.block) expect(d.warnings[0]).toContain("REC-1405-0001");
  });
  it("no duplicates, no warnings", () => {
    expect(decideDuplicates({ hard: [], soft: [] }, false)).toEqual({ block: false, warnings: [] });
  });
  it("describes a posted document with its number and exact amount", () => {
    const text = describeDuplicate(row({ status: "POSTED", display_number: "PAY-1", kind: "PAYMENT", amount: "12345678901234" }));
    expect(text).toContain("قطعی‌شده");
    expect(text).toContain("PAY-1");
    expect(text).toContain("۱۲٬۳۴۵٬۶۷۸٬۹۰۱٬۲۳۴");
  });
});

describe("preview", () => {
  const base: PreviewInput = {
    kind: "RECEIPT", amount: "100000000", currency: "IRR", dateIso: "2026-10-01", counterparty: "شرکت الف", companyName: "شرکت الف",
    contractLabel: null, bankAccountLabel: null, method: "TRANSFER", reference: "123456", description: null, source: "IMAGE",
    confidence: "HIGH", warnings: [], openInvoiceHints: [], fiscalYearFound: false,
  };
  it("states it is only a draft and names what the accountant must complete", () => {
    const t = buildCashPreview(base);
    expect(t).toContain("فقط پیش‌نویس");
    expect(t).toContain("فقط توسط حسابدار");
    expect(t).toContain("حساب بانکی/صندوق");
    expect(t).toContain("حساب طرف مقابل");
    expect(t).toContain("سال مالی");
    expect(t).toContain("بدون تبدیل واحد");
    expect(t).toContain("۱۰۰٬۰۰۰٬۰۰۰");
  });
  it("never claims verified / posted / settled", () => {
    const t = buildCashPreview(base);
    expect(t).not.toMatch(/تأیید شد|ثبت قطعی شد|تسویه شد/);
  });
  it("shows warnings, low confidence, invoice hints and the bank account when known", () => {
    const t = buildCashPreview({ ...base, confidence: "LOW", warnings: ["⚠️ شباهت: x"], openInvoiceHints: ["فاکتور F-1"], bankAccountLabel: "حساب سینا", fiscalYearFound: true });
    expect(t).toContain("پایین");
    expect(t).toContain("⚠️ شباهت: x");
    expect(t).toContain("فاکتور F-1");
    expect(t).toContain("حساب بانکی: حساب سینا");
    expect(t).not.toContain("سال مالی");
  });
  it("payments label the party as the receiver", () => {
    expect(buildCashPreview({ ...base, kind: "PAYMENT" })).toContain("دریافت‌کننده: شرکت الف");
  });
  it("missingAccountingFields never lets the assistant pick the counterpart account", () => {
    expect(missingAccountingFields({ bankAccountLabel: "x", fiscalYearFound: true })).toEqual(["حساب طرف مقابل"]);
  });
});

describe("helpers", () => {
  it("cleanText strips control characters, collapses spaces and caps length", () => {
    expect(cleanText("  a\u0000b\n\n c\t", 100)).toBe("a b c");
    expect(cleanText("x".repeat(600), 500)?.length).toBe(500);
    expect(cleanText("   ", 10)).toBeNull();
    expect(cleanText(null, 10)).toBeNull();
  });
  it("sha256Hex is the standard digest", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

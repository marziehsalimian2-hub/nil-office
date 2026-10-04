import { describe, it, expect } from "vitest";
import { buildPayslipHtml, paymentBlockHtml, type PayslipHtmlInput } from "./payslipHtml";
import { payslipFileName, type PayslipData } from "@/lib/payroll/payslip";

const base: PayslipData = {
  result_id: "r1",
  personnel_id: "p1",
  batch: { id: "b1", batch_number: "PRL-1405-0001", currency: "IRR" },
  period: { jalali_year: 1405, jalali_month: 7, period_start: "2026-09-23", period_end: "2026-10-22" },
  personnel: { number: "EMP-1405-0001", name: "سید سامان حسینی رضوانی", job_title: "کارشناس", department: "فنی", hire_date: "2026-03-21" },
  lines: [
    { code: "BASE_SALARY", name: "حقوق پایه", type: "EARNING", amount: "10000000.0000" },
    { code: "HOUSING", name: "حق مسکن", type: "EARNING", amount: "1000000.0000" },
    { code: "INS", name: "بیمه", type: "DEDUCTION", amount: "770000.0000" },
  ],
  totals: { gross: "11000000.0000", deductions: "770000.0000", net: "10230000.0000" },
  payment: { state: "NOT_PAID", paid: "0.0000", last_date: null, numbers: [] },
  next_revision: 1,
  latest_revision: null,
  can_issue: true,
  reason: null,
};
const input = (d: PayslipData, over: Partial<PayslipHtmlInput> = {}): PayslipHtmlInput => ({
  data: d, revision: 1, companyName: "شرکت مدیریت راهبردی نیل", issuedAtLabel: "۱۴۰۵/۰۷/۱۲ — ۱۰:۳۰", stampDataUri: null, ...over,
});

describe("payslip HTML", () => {
  it("shows earnings, deductions, totals and identity", () => {
    const html = buildPayslipHtml(input(base), "AAAA");
    expect(html).toContain("حقوق پایه");
    expect(html).toContain("بیمه");
    expect(html).toContain("سید سامان حسینی رضوانی");
    expect(html).toContain("۱۰٬۲۳۰٬۰۰۰");          // net, exact string formatting
    expect(html).toContain("فیش حقوقی");
    expect(html).toContain("محرمانه");
  });

  it("a NOT_PAID payslip never claims it was paid", () => {
    const html = buildPayslipHtml(input(base), "AAAA");
    expect(html).toContain("در انتظار پرداخت");
    expect(html).not.toContain("پرداخت‌شده");
    expect(html).not.toContain("تاریخ پرداخت");
  });

  it("a PARTIALLY_PAID payslip shows the paid amount but not «پرداخت‌شده»", () => {
    const d = { ...base, payment: { state: "PARTIALLY_PAID" as const, paid: "4000000.0000", last_date: "2026-10-01", numbers: ["PMT-1405-0001"] } };
    const html = buildPayslipHtml(input(d), "AAAA");
    expect(html).toContain("پرداخت ناقص");
    expect(html).toContain("۴٬۰۰۰٬۰۰۰");
    expect(html).not.toContain("وضعیت پرداخت در زمان صدور این فیش:</span> <b>پرداخت‌شده");
  });

  it("a PAID payslip shows the date and the payment number", () => {
    const d = { ...base, payment: { state: "PAID" as const, paid: "10230000.0000", last_date: "2026-10-01", numbers: ["PMT-1405-0007"] } };
    const block = paymentBlockHtml(d);
    expect(block).toContain("پرداخت‌شده");
    expect(block).toContain("تاریخ پرداخت");
    expect(block).toContain("۱۴۰۵/۰۷/۰۹");
    expect(block).toContain("PMT-1405-0007");   // identifiers keep their stored (Latin) form inside an LTR isolate
  });

  it("never renders employer cost, rules or warnings (they are not even in the input type)", () => {
    const html = buildPayslipHtml(input(base), "AAAA");
    for (const banned of ["هزینهٔ کارفرما", "EMPLOYER", "rule_key", "هشدار", "INFORMATIONAL"]) expect(html).not.toContain(banned);
  });

  it("escapes HTML in names and uses the revision number", () => {
    const d = { ...base, personnel: { ...base.personnel, name: "<script>x</script>" } };
    const html = buildPayslipHtml(input(d, { revision: 2 }), "AAAA");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("نسخهٔ ۲");
  });

  it("builds an ASCII-safe archive file name", () => {
    expect(payslipFileName("EMP-1405-0001", 1405, 7, 2)).toBe("payslip-EMP-1405-0001-1405-07-r2.pdf");
    expect(payslipFileName("EMP ۱۴۰۵/۱", 1405, 12, 1)).toBe("payslip-EMP-1405-12-r1.pdf");
  });
});

import { formatExactAmount } from "@/lib/payroll/format";
import { describeQuantityLine } from "@/lib/payroll/quantity";
import { describeProration, readProration } from "@/lib/payroll/proration";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { CURRENCY_LABEL, type Currency } from "@/lib/enums";
import { PAYSLIP_STATE_LABEL, payslipPeriodLabel, type PayslipData } from "@/lib/payroll/payslip";

/**
 * PURE payslip HTML builder (no fs, no puppeteer, no DB) so it is unit-testable; the renderer supplies the font and the PDF step.
 * Confidentiality rules baked in here: earnings and deductions ONLY (employer cost, informational lines, rules, warnings and
 * calculation metadata never reach this builder's input), and the payment block states the status AS OF ISSUANCE — it can only say
 * «پرداخت‌شده» when the derived state is PAID.
 */
export type PayslipHtmlInput = {
  data: PayslipData;
  revision: number;
  companyName: string;
  issuedAtLabel: string;       // already formatted (Jalali date + time)
  stampDataUri: string | null;
};

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function linesTable(title: string, rows: PayslipData["lines"], currencyLabel: string, currencyCode: string): string {
  if (rows.length === 0) return `<p class="muted">${esc(title)}: موردی ثبت نشده است.</p>`;
  return `<table class="data"><thead><tr><th>${esc(title)}</th><th class="amt">مبلغ (${esc(currencyLabel)})</th></tr></thead><tbody>${rows
    .map((r) => {
      // overtime / absence lines show how the amount came about («۱۰ ساعت × نرخ»): quantity + unit rate are exact strings from the database
      const q = describeQuantityLine({ quantity: r.quantity, unit: r.unit, unit_rate: r.unit_rate }, currencyCode);
      // a part-month line (hired / left mid-period) says how it was prorated («متناسب با ۱۰ روز از ۳۱ روز»)
      const pr = describeProration(readProration(r.proration));
      return `<tr><td class="name">${esc(r.name)}${q ? `<div class="muted">${esc(q)}</div>` : ""}${pr ? `<div class="muted">${esc(pr)}</div>` : ""}</td><td class="amt">${esc(formatExactAmount(r.amount))}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

export function paymentBlockHtml(data: PayslipData): string {
  const p = data.payment;
  const label = PAYSLIP_STATE_LABEL[p.state];
  const cur = CURRENCY_LABEL[data.batch.currency as Currency] ?? data.batch.currency;
  let detail = "";
  if (p.state === "PAID") {
    detail = `${p.last_date ? `تاریخ پرداخت: ${esc(formatJalali(p.last_date))}` : ""}${
      p.numbers.length ? `${p.last_date ? " — " : ""}شمارهٔ پرداخت: <bdi dir="ltr" class="ltr">${esc(p.numbers.join("، "))}</bdi>` : ""
    }`;
  } else if (p.state === "PARTIALLY_PAID") {
    detail = `پرداخت‌شده: ${esc(formatExactAmount(p.paid))} ${esc(cur)} از ${esc(formatExactAmount(data.totals.net))} ${esc(cur)}`;
  }
  return `<div class="pay"><span class="k">وضعیت پرداخت در زمان صدور این فیش:</span> <b>${esc(label)}</b>${detail ? `<div class="pdetail">${detail}</div>` : ""}</div>`;
}

export function buildPayslipHtml(input: PayslipHtmlInput, fontBase64: string): string {
  const d = input.data;
  const cur = CURRENCY_LABEL[d.batch.currency as Currency] ?? d.batch.currency;
  const earnings = d.lines.filter((l) => l.type === "EARNING");
  const deductions = d.lines.filter((l) => l.type === "DEDUCTION");
  const fontFace = `@font-face { font-family: "BNazanin"; src: url(data:font/ttf;base64,${fontBase64}) format("truetype"); font-weight: 400 700; }`;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8" /><style>
  ${fontFace}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "BNazanin", "Tahoma", sans-serif; direction: rtl; color: #1a1a1a; font-size: 12px; line-height: 1.9; }
  .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1pt solid #1a1a1a55; padding-bottom: 3mm; margin-bottom: 5mm; }
  .head .company { font-size: 13px; font-weight: 700; }
  .head .title { font-size: 17px; font-weight: 700; }
  .head .rev { font-size: 11px; color: #555; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 5mm; }
  table.kv td { padding: 1.4mm 2mm; border-bottom: 0.5pt solid #1a1a1a1a; }
  table.kv td.k { color: #555; width: 22%; }
  table.kv td.v { font-weight: 700; width: 28%; }
  .cols { display: flex; gap: 6mm; align-items: flex-start; margin-bottom: 5mm; }
  .cols > div { flex: 1; }
  table.data { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.data thead th { background: #f2f2ef; border: 0.5pt solid #1a1a1a33; padding: 1.6mm 2mm; font-weight: 700; text-align: right; }
  table.data td { border: 0.5pt solid #1a1a1a22; padding: 1.6mm 2mm; }
  .amt { direction: ltr; text-align: left; white-space: nowrap; }
  .ltr { direction: ltr; unicode-bidi: isolate; font-family: "Tahoma", "Arial", sans-serif; font-size: 11px; }   /* stored identifiers (EMP-…, PMT-…) keep their Latin form + hyphens */
  .totals { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  .totals td { padding: 2mm 3mm; border: 0.5pt solid #1a1a1a33; }
  .totals td.k { background: #f7f7f4; width: 55%; }
  .totals tr.net td { font-size: 14px; font-weight: 700; background: #eef3ee; }
  .pay { border: 1pt solid #1a1a1a33; border-radius: 2mm; padding: 3mm 4mm; margin-bottom: 5mm; }
  .pay .k { color: #555; }
  .pay .pdetail { margin-top: 1mm; font-size: 11px; color: #333; }
  .muted { color: #777; font-size: 11px; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8mm; font-size: 10.5px; color: #555; }
  .foot img { max-height: 22mm; max-width: 40mm; }
  .conf { margin-top: 4mm; font-size: 10px; color: #888; text-align: center; }
</style></head>
<body>
  <div class="head">
    <span class="company">${esc(input.companyName)}</span>
    <span class="title">فیش حقوقی — ${esc(payslipPeriodLabel(d.period))}</span>
    <span class="rev">نسخهٔ ${esc(toFaDigits(input.revision))}</span>
  </div>
  <table class="kv"><tbody>
    <tr><td class="k">نام و نام خانوادگی</td><td class="v">${esc(d.personnel.name)}</td><td class="k">شمارهٔ پرسنلی</td><td class="v"><bdi dir="ltr" class="ltr">${esc(d.personnel.number)}</bdi></td></tr>
    <tr><td class="k">عنوان شغلی</td><td class="v">${esc(d.personnel.job_title ?? "—")}</td><td class="k">واحد</td><td class="v">${esc(d.personnel.department ?? "—")}</td></tr>
    <tr><td class="k">تاریخ استخدام</td><td class="v">${esc(formatJalali(d.personnel.hire_date))}</td><td class="k">بازهٔ دوره</td><td class="v">${esc(formatJalali(d.period.period_start))} تا ${esc(formatJalali(d.period.period_end))}</td></tr>
  </tbody></table>
  <div class="cols">
    <div>${linesTable("مزایا", earnings, cur, d.batch.currency)}</div>
    <div>${linesTable("کسورات", deductions, cur, d.batch.currency)}</div>
  </div>
  <table class="totals"><tbody>
    <tr><td class="k">جمع مزایا (ناخالص)</td><td class="amt">${esc(formatExactAmount(d.totals.gross))} ${esc(cur)}</td></tr>
    <tr><td class="k">جمع کسورات</td><td class="amt">${esc(formatExactAmount(d.totals.deductions))} ${esc(cur)}</td></tr>
    <tr class="net"><td class="k">خالص قابل پرداخت</td><td class="amt">${esc(formatExactAmount(d.totals.net))} ${esc(cur)}</td></tr>
  </tbody></table>
  ${paymentBlockHtml(d)}
  <div class="foot">
    <span>تاریخ صدور: ${esc(input.issuedAtLabel)}</span>
    ${input.stampDataUri ? `<img src="${input.stampDataUri}" />` : "<span></span>"}
  </div>
  <p class="conf">این فیش محرمانه است و فقط برای شخص مذکور صادر شده است.</p>
</body></html>`;
}

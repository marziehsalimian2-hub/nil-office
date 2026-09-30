import "server-only";
import puppeteer from "puppeteer";
import {
  A4_WIDTH_PT,
  MM_TO_PT,
  PX_TO_PT,
  esc,
  faDigits,
  loadFontBase64,
  renderSnippetPng,
  compositePdfPages,
  drawFullPageBackground,
} from "@/lib/pdf/pdfShared";

export type AllocationLine = { targetTypeLabel: string; targetLabel: string; amountLabel: string; description: string | null };

/**
 * Structured, fully-formatted input — no DB access here, mirrors every
 * other render*Pdf.ts convention (renderInvoicePdf.ts etc.) of a pure
 * presentational function. All money/date formatting already happened
 * in lib/pdf/receiptPaymentData.ts. Uses pdfShared.ts (not a fifth copy
 * of the older renderers' inline boilerplate) — this template is simple
 * enough that reuse is a clean fit, same reasoning renderClientServiceReportPdf.ts
 * already established for that shared module.
 */
export type ReceiptPaymentPdfInput = {
  kind: "RECEIPT" | "PAYMENT";
  title: string;
  displayNumber: string;
  dateLabel: string;
  partyLabel: string;
  partyName: string;
  amountLabel: string;
  currencyLabel: string;
  methodLabel: string | null;
  referenceLabel: string | null;
  description: string | null;
  bankLabel: string | null;
  bankAccountNumberLabel: string | null;
  allocations: AllocationLine[];
  signatoryName: string | null;
  signatoryTitle: string | null;
  letterheadDataUri: string | null;
  stampDataUri: string | null;
  signatureDataUri: string | null;
};

let cachedFontBase64: string | null = null;
function fontBase64(): string {
  if (cachedFontBase64) return cachedFontBase64;
  cachedFontBase64 = loadFontBase64("B-Nazanin.ttf");
  return cachedFontBase64;
}

const FONT_FACE = `@font-face {
  font-family: "BNazanin";
  src: url(data:font/ttf;base64,${fontBase64()}) format("truetype");
  font-weight: 400 700;
}`;

function allocationsTableHtml(rows: AllocationLine[]): string {
  if (rows.length === 0) return `<p class="muted">تخصیصی برای این سند ثبت نشده است.</p>`;
  return `<table class="data"><thead><tr><th>نوع</th><th>بابت</th><th>شرح</th><th>مبلغ</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><td>${esc(r.targetTypeLabel)}</td><td>${esc(r.targetLabel)}</td><td>${esc(r.description ?? "—")}</td><td class="ltr">${esc(r.amountLabel)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function buildHtml(input: ReceiptPaymentPdfInput): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8" /><style>
  ${FONT_FACE}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "BNazanin", "Tahoma", sans-serif; direction: rtl; color: #1a1a1a; font-size: 12px; line-height: 1.9; }
  .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1pt solid #1a1a1a55; padding-bottom: 3mm; margin-bottom: 5mm; }
  .head .title { font-size: 16px; font-weight: 700; }
  .head .num { font-size: 12px; color: #444; direction: ltr; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 5mm; }
  table.kv td { padding: 1.6mm 2mm; border-bottom: 0.5pt solid #1a1a1a1a; }
  table.kv td.k { color: #555; width: 32%; }
  table.kv td.v { font-weight: 700; }
  .amount-box { border: 1pt solid #1a1a1a33; border-radius: 2mm; padding: 4mm; margin-bottom: 5mm; text-align: center; }
  .amount-box .amount { font-size: 18px; font-weight: 700; }
  table.data { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 5mm; }
  table.data thead th { background: #f2f2ef; border: 0.5pt solid #1a1a1a33; padding: 1.6mm 1mm; font-weight: 700; text-align: center; }
  table.data td { border: 0.5pt solid #1a1a1a22; padding: 1.6mm 1mm; text-align: center; }
  .ltr { direction: ltr; }
  .muted { color: #777; font-size: 11px; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 14mm; }
  .sign-box { text-align: center; width: 45%; }
  .sign-box img { max-height: 20mm; max-width: 100%; }
  .sign-box .line { border-top: 0.5pt solid #1a1a1a55; margin-top: 2mm; padding-top: 1.5mm; font-size: 10.5px; color: #555; }
</style></head>
<body>
  <div class="head">
    <span class="title">${esc(input.title)}</span>
    <span class="num">${esc(input.displayNumber)} — ${esc(input.dateLabel)}</span>
  </div>
  <table class="kv"><tbody>
    <tr><td class="k">${esc(input.partyLabel)}</td><td class="v">${esc(input.partyName)}</td></tr>
    ${input.methodLabel ? `<tr><td class="k">روش</td><td class="v">${esc(input.methodLabel)}</td></tr>` : ""}
    ${input.referenceLabel ? `<tr><td class="k">شماره پیگیری</td><td class="v ltr">${esc(input.referenceLabel)}</td></tr>` : ""}
    ${input.bankLabel ? `<tr><td class="k">حساب بانکی</td><td class="v">${esc(input.bankLabel)}${input.bankAccountNumberLabel ? ` — ${esc(input.bankAccountNumberLabel)}` : ""}</td></tr>` : ""}
    ${input.description ? `<tr><td class="k">شرح</td><td class="v">${esc(input.description)}</td></tr>` : ""}
  </tbody></table>
  <div class="amount-box"><p class="muted">مبلغ</p><p class="amount">${esc(input.amountLabel)} ${esc(input.currencyLabel)}</p></div>
  <p style="font-weight:700; margin-bottom: 2mm;">بابت</p>
  ${allocationsTableHtml(input.allocations)}
  <div class="sign-row">
    <div class="sign-box">
      ${input.signatureDataUri ? `<img src="${input.signatureDataUri}" />` : ""}
      <div class="line">${esc(input.signatoryName ?? "")}${input.signatoryTitle ? ` — ${esc(input.signatoryTitle)}` : ""}</div>
    </div>
    <div class="sign-box">
      ${input.stampDataUri ? `<img src="${input.stampDataUri}" />` : ""}
      <div class="line">مهر شرکت</div>
    </div>
  </div>
</body></html>`;
}

function buildFooterHtml(pageIndex: number, pageCount: number): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8" /><style>
    ${FONT_FACE}
    html, body { margin:0; padding:0; background: transparent; }
    body { font-family: "BNazanin", sans-serif; direction: rtl; color:#666; font-size:10px; display:flex; justify-content:center; align-items:center; height:100%; }
  </style></head><body><span>صفحهٔ ${faDigits(pageIndex + 1)} از ${faDigits(pageCount)}</span></body></html>`;
}

const FOOTER_WIDTH_PX = 300;
const FOOTER_HEIGHT_PX = 24;

export async function renderReceiptPaymentPdf(input: ReceiptPaymentPdfInput): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(input), { waitUntil: "load" });
    const textPdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: input.letterheadDataUri ? "45mm" : "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
    });
    return await compositePdfPages(textPdfBytes, async (outDoc, outPage, pageIndex, pageCount) => {
      if (input.letterheadDataUri) await drawFullPageBackground(outDoc, outPage, input.letterheadDataUri);
      const footerPng = await renderSnippetPng(browser, buildFooterHtml(pageIndex, pageCount), FOOTER_WIDTH_PX, FOOTER_HEIGHT_PX);
      const embedded = await outDoc.embedPng(footerPng);
      const w = FOOTER_WIDTH_PX * PX_TO_PT;
      const h = FOOTER_HEIGHT_PX * PX_TO_PT;
      outPage.drawImage(embedded, { x: (A4_WIDTH_PT - w) / 2, y: 8 * MM_TO_PT, width: w, height: h });
    });
  } finally {
    await browser.close();
  }
}

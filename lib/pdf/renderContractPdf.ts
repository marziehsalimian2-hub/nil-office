import "server-only";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { PDFDocument } from "pdf-lib";

export type ContractPdfInput = {
  displayNumber: string | null;
  dateLabel: string; // already-formatted Jalali date string
  title: string;
  typeLabel: string | null;
  kindLabel: string;
  statusLabel: string;
  counterpartyLabel: string | null;
  caseLabel: string | null;
  signedDateLabel: string;
  effectiveDateLabel: string;
  expiryDateLabel: string;
  baseAmountLabel: string;
  discountAmountLabel: string;
  taxAmountLabel: string;
  totalAmountLabel: string;
  currencyCode: string;
  description: string | null;
  responsibleLabel: string | null;
  approverLabel: string | null;
  letterheadDataUri: string | null;
  stampDataUri: string | null;
  signatureDataUri: string | null;
};

// Kept self-contained (rather than importing from renderLetterPdf.ts) so this
// print pipeline can evolve independently of the letter one — same pattern
// the codebase already uses for validation helpers duplicated between
// lib/validation.ts and lib/validation-accounting.ts.
let cachedFontBase64: string | null = null;
function fontBase64(): string {
  if (cachedFontBase64) return cachedFontBase64;
  const fontPath = path.join(process.cwd(), "app", "fonts", "Vazirmatn-Variable.woff2");
  cachedFontBase64 = fs.readFileSync(fontPath).toString("base64");
  return cachedFontBase64;
}

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const FONT_FACE = `@font-face {
  font-family: "Vazirmatn";
  src: url(data:font/woff2;base64,${fontBase64()}) format("woff2");
  font-weight: 100 900;
}`;

/** Structured summary body — no letterhead image, no date/number overlay
 * (composited afterwards, same reasoning as renderLetterPdf.ts). */
function buildContractHtml(input: ContractPdfInput): string {
  const {
    title, typeLabel, kindLabel, statusLabel, counterpartyLabel, caseLabel,
    signedDateLabel, effectiveDateLabel, expiryDateLabel,
    baseAmountLabel, discountAmountLabel, taxAmountLabel, totalAmountLabel, currencyCode,
    description, responsibleLabel, approverLabel, stampDataUri, signatureDataUri,
  } = input;

  const row = (label: string, value: string | null) =>
    value ? `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>` : "";

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  ${FONT_FACE}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Vazirmatn", sans-serif;
    direction: rtl;
    color: #1a1a1a;
    font-size: 13px;
    line-height: 1.9;
  }
  .title { margin-bottom: 6mm; font-size: 16px; font-weight: 700; text-align: center; }
  .section-title { margin: 6mm 0 2mm; font-size: 13px; font-weight: 700; border-bottom: 0.5pt solid #1a1a1a55; padding-bottom: 1mm; }
  .row { display: flex; gap: 3mm; padding: 1.4mm 0; border-bottom: 0.5pt solid #1a1a1a22; }
  .label { width: 38mm; flex-shrink: 0; color: #444; }
  .value { flex: 1; font-weight: 600; }
  .description { margin-top: 2mm; white-space: pre-wrap; }
  .signoff {
    margin-top: 16mm;
    text-align: left;
    font-size: 12px;
  }
  .approver-label { font-weight: 700; }
  .stamp-row {
    position: relative;
    display: inline-block;
    width: 42mm;
    height: 33mm;
    margin-top: 2mm;
  }
  .stamp-row img.stamp {
    position: absolute;
    bottom: 0;
    left: 0;
    max-width: 28mm;
    max-height: 28mm;
    opacity: 0.9;
  }
  .stamp-row img.signature {
    position: absolute;
    bottom: 13mm;
    right: 0;
    max-width: 48mm;
    max-height: 20mm;
  }
</style>
</head>
<body>
  <div class="title">برگ خلاصهٔ قرارداد</div>

  <div class="section-title">مشخصات کلی</div>
  ${row("عنوان قرارداد", title)}
  ${row("نوع قرارداد", typeLabel)}
  ${row("دستهٔ قرارداد", kindLabel)}
  ${row("وضعیت", statusLabel)}
  ${row("طرف قرارداد", counterpartyLabel)}
  ${row("پروندهٔ مرتبط", caseLabel)}
  ${row("مسئول قرارداد", responsibleLabel)}

  <div class="section-title">تاریخ‌ها</div>
  ${row("تاریخ عقد", signedDateLabel)}
  ${row("تاریخ شروع", effectiveDateLabel)}
  ${row("تاریخ پایان", expiryDateLabel)}

  <div class="section-title">مبالغ (${esc(currencyCode)})</div>
  ${row("مبلغ پایه", baseAmountLabel)}
  ${row("تخفیف", discountAmountLabel)}
  ${row("مالیات/ارزش‌افزوده", taxAmountLabel)}
  ${row("مبلغ نهایی", totalAmountLabel)}

  ${description ? `<div class="section-title">شرح قرارداد</div><div class="description">${esc(description)}</div>` : ""}

  <div class="signoff">
    ${approverLabel ? `<div class="approver-label">تأییدکنندهٔ نیل: ${esc(approverLabel)}</div>` : ""}
    <div class="stamp-row">
      ${stampDataUri ? `<img class="stamp" src="${stampDataUri}" />` : ""}
      ${signatureDataUri ? `<img class="signature" src="${signatureDataUri}" />` : ""}
    </div>
  </div>
</body>
</html>`;
}

function buildHeaderFieldsHtml(dateLabel: string, displayNumber: string | null): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  ${FONT_FACE}
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: "Vazirmatn", sans-serif;
    direction: rtl;
    text-align: left;
    color: #1a1a1a;
    font-size: 15px;
    line-height: 22px;
  }
</style>
</head>
<body>
  <div>${esc(dateLabel)}</div>
  <div>${displayNumber ? esc(displayNumber) : "پیش‌نویس"}</div>
</body>
</html>`;
}

const HEADER_SNIPPET_WIDTH_PX = 400;
const HEADER_SNIPPET_HEIGHT_PX = 90;
const PX_TO_PT = 0.75; // CSS px (96dpi) -> PDF points (72dpi)

async function renderHeaderFieldsPng(browser: Browser, dateLabel: string, displayNumber: string | null) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: HEADER_SNIPPET_WIDTH_PX, height: HEADER_SNIPPET_HEIGHT_PX, deviceScaleFactor: 3 });
    await page.setContent(buildHeaderFieldsHtml(dateLabel, displayNumber), { waitUntil: "load" });
    return await page.screenshot({ type: "png", omitBackground: true });
  } finally {
    await page.close();
  }
}

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MM_TO_PT = A4_WIDTH_PT / 210;

function dataUriToBytes(dataUri: string): { bytes: Uint8Array; isJpg: boolean } {
  const [meta, b64] = dataUri.split(",");
  return { bytes: Buffer.from(b64, "base64"), isJpg: /jpeg|jpg/i.test(meta) };
}

export async function renderContractPdf(input: ContractPdfInput): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let textPdfBytes: Uint8Array;
  let headerPng: Uint8Array | null = null;
  try {
    const page = await browser.newPage();
    await page.setContent(buildContractHtml(input), { waitUntil: "load" });
    textPdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "60mm", bottom: "30mm", left: "20mm", right: "20mm" },
    });

    if (input.letterheadDataUri) {
      headerPng = await renderHeaderFieldsPng(browser, input.dateLabel, input.displayNumber);
    }
  } finally {
    await browser.close();
  }

  const textDoc = await PDFDocument.load(textPdfBytes);
  const pageCount = textDoc.getPageCount();

  const outDoc = await PDFDocument.create();
  const embeddedTextPages = await outDoc.embedPdf(textPdfBytes, Array.from({ length: pageCount }, (_, i) => i));

  for (let i = 0; i < pageCount; i++) {
    const outPage = outDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

    if (i === 0 && input.letterheadDataUri) {
      const { bytes, isJpg } = dataUriToBytes(input.letterheadDataUri);
      const img = isJpg ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes);
      outPage.drawImage(img, { x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT });

      if (headerPng) {
        const embeddedHeader = await outDoc.embedPng(headerPng);
        const w = HEADER_SNIPPET_WIDTH_PX * PX_TO_PT;
        const h = HEADER_SNIPPET_HEIGHT_PX * PX_TO_PT;
        outPage.drawImage(embeddedHeader, {
          x: 22 * MM_TO_PT,
          y: A4_HEIGHT_PT - 14 * MM_TO_PT - h,
          width: w,
          height: h,
        });
      }
    }

    outPage.drawPage(embeddedTextPages[i], { x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
  }

  const finalBytes = await outDoc.save();
  return Buffer.from(finalBytes);
}

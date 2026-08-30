import "server-only";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

export type LetterPdfInput = {
  displayNumber: string | null;
  dateLabel: string; // already-formatted Jalali date string
  recipientLabel: string | null;
  subject: string | null;
  bodyHtml: string; // must already be sanitized
  signatoryName: string | null;
  signatoryTitle: string | null;
  letterheadDataUri: string | null;
  stampDataUri: string | null;
  signatureDataUri: string | null;
};

let cachedFontBase64: string | null = null;
function fontBase64(): string {
  if (cachedFontBase64) return cachedFontBase64;
  const fontPath = path.join(process.cwd(), "app", "fonts", "Vazirmatn-Variable.woff2");
  cachedFontBase64 = fs.readFileSync(fontPath).toString("base64");
  return cachedFontBase64;
}

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Builds the full HTML document rendered to PDF. Layout is a first pass —
 * the top/bottom safe margins and the exact signature/stamp placement are
 * meant to be tuned once against the company's real letterhead image.
 */
export function buildLetterHtml(input: LetterPdfInput): string {
  const {
    displayNumber,
    dateLabel,
    recipientLabel,
    subject,
    bodyHtml,
    signatoryName,
    signatoryTitle,
    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  } = input;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "Vazirmatn";
    src: url(data:font/woff2;base64,${fontBase64()}) format("woff2");
    font-weight: 100 900;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Vazirmatn", sans-serif;
    direction: rtl;
    color: #1a1a1a;
    position: relative;
    width: 210mm;
    height: 297mm;
  }
  .letterhead {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: -1;
  }
  .content {
    padding: 55mm 20mm 45mm 20mm;
    font-size: 13px;
    line-height: 2;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 10mm;
  }
  .meta .num { font-weight: 700; }
  .recipient { margin-bottom: 4mm; font-weight: 700; }
  .subject { margin-bottom: 8mm; }
  .subject b { text-decoration: underline; }
  .body p { margin: 0 0 3mm 0; }
  .body ul, .body ol { margin: 0 0 3mm 0; padding-inline-start: 6mm; }
  .signoff {
    position: absolute;
    bottom: 30mm;
    left: 20mm;
    right: 20mm;
    text-align: left;
    font-size: 12px;
  }
  .stamp-row {
    position: relative;
    display: inline-block;
    width: 45mm;
    height: 25mm;
  }
  .stamp-row img.signature {
    position: absolute;
    bottom: 8mm;
    right: 0;
    max-width: 40mm;
    max-height: 15mm;
  }
  .stamp-row img.stamp {
    position: absolute;
    bottom: 0;
    left: 0;
    max-width: 30mm;
    max-height: 30mm;
    opacity: 0.9;
  }
  .signatory-name { font-weight: 700; margin-top: 2mm; }
</style>
</head>
<body>
  ${letterheadDataUri ? `<img class="letterhead" src="${letterheadDataUri}" />` : ""}
  <div class="content">
    <div class="meta">
      <span class="num">${displayNumber ? `شماره: ${esc(displayNumber)}` : "پیش‌نویس"}</span>
      <span>تاریخ: ${esc(dateLabel)}</span>
    </div>
    ${recipientLabel ? `<div class="recipient">گیرنده: ${esc(recipientLabel)}</div>` : ""}
    ${subject ? `<div class="subject">موضوع: <b>${esc(subject)}</b></div>` : ""}
    <div class="body">${bodyHtml}</div>
  </div>
  <div class="signoff">
    <div class="stamp-row">
      ${signatureDataUri ? `<img class="signature" src="${signatureDataUri}" />` : ""}
      ${stampDataUri ? `<img class="stamp" src="${stampDataUri}" />` : ""}
    </div>
    ${signatoryName ? `<div class="signatory-name">${esc(signatoryName)}</div>` : ""}
    ${signatoryTitle ? `<div>${esc(signatoryTitle)}</div>` : ""}
  </div>
</body>
</html>`;
}

export async function renderLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildLetterHtml(input), { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

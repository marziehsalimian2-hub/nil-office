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
  }
  .letterhead {
    /* fixed (not absolute) so it repeats on every printed page if the
       letter runs long enough to overflow onto a second page */
    position: fixed;
    inset: 0;
    width: 100%;
    height: 297mm;
    object-fit: cover;
    z-index: -1;
  }
  .content {
    padding: 55mm 20mm 25mm 20mm;
    font-size: 13px;
    line-height: 2;
  }
  /* Overlaid on the letterhead's own DATE:/NO: labels (top-left).
     Coordinates are calibrated against the current letterhead image —
     nudge top/left here if a different letterhead is uploaded later. */
  .header-fields {
    position: absolute;
    top: 14.5mm;
    left: 22mm;
    font-size: 11px;
    line-height: 5.7mm;
    text-align: left;
  }
  .recipient { margin-bottom: 4mm; font-weight: 700; }
  .subject { margin-bottom: 8mm; }
  .subject b { text-decoration: underline; }
  .body p { margin: 0 0 3mm 0; }
  .body ul, .body ol { margin: 0 0 3mm 0; padding-inline-start: 6mm; }
  .signoff {
    /* a sibling of .content (not nested inside it), so it needs the
       same horizontal margin .content gets via padding. Flows right
       after the letter body instead of pinning to the page bottom —
       a short letter gets its signature close to the text, a long one
       lands wherever the text actually ends (and onto page 2 if needed) */
    margin: 20mm 20mm 25mm 20mm;
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
</style>
</head>
<body>
  ${letterheadDataUri ? `<img class="letterhead" src="${letterheadDataUri}" />` : ""}
  <div class="header-fields">
    <div>${esc(dateLabel)}</div>
    <div>${displayNumber ? esc(displayNumber) : "پیش‌نویس"}</div>
  </div>
  <div class="content">
    ${recipientLabel ? `<div class="recipient">گیرنده: ${esc(recipientLabel)}</div>` : ""}
    ${subject ? `<div class="subject">موضوع: <b>${esc(subject)}</b></div>` : ""}
    <div class="body">${bodyHtml}</div>
  </div>
  <div class="signoff">
    <div class="stamp-row">
      ${signatureDataUri ? `<img class="signature" src="${signatureDataUri}" />` : ""}
      ${stampDataUri ? `<img class="stamp" src="${stampDataUri}" />` : ""}
    </div>
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

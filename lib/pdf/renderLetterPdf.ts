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
  signatoryLabel: string | null; // free text set per-letter (name/title under the signature)
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
    signatoryLabel,
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
    /* absolute (not fixed): Chromium's print-to-PDF does not reliably
       repeat position:fixed content at the top of each physical page —
       in practice it lands the image once, at an arbitrary point in the
       flow, which looked far worse than just showing the letterhead on
       page 1 only. Continuation pages (rare — most letters fit on one
       page) render on plain white with a normal margin instead. */
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 297mm;
    object-fit: cover;
    z-index: -1;
  }
  .content {
    /* All page spacing lives here in plain CSS padding — page.pdf() is
       called with margin:0 below. Mixing a PDF-level margin with a
       297mm-tall absolutely-positioned letterhead image caused Chromium
       to shrink the usable per-page height by the margin amount, which
       pushed the bottom of that image (its footer bar) onto a spurious
       page 2 even for a one-paragraph letter. Padding-top clears the
       header art, padding-bottom the footer bar; both apply once (start
       and end of this block), which is exactly right for page 1. */
    padding: 60mm 20mm 48mm 20mm;
    font-size: 13px;
    line-height: 2;
  }
  /* Overlaid on the letterhead's own DATE:/NO: labels (top-left).
     Coordinates are calibrated against the current letterhead image —
     nudge top/left here if a different letterhead is uploaded later.
     absolute (not fixed) for the same reason as .letterhead above —
     this only ever needs to appear on page 1. */
  .header-fields {
    position: absolute;
    top: 14mm;
    left: 22mm;
    font-size: 11px;
    line-height: 5.2mm;
    text-align: left;
  }
  .recipient { margin-bottom: 4mm; font-weight: 700; }
  .subject { margin-bottom: 8mm; }
  .subject b { text-decoration: underline; }
  .body p { margin: 0 0 3mm 0; }
  .body ul, .body ol { margin: 0 0 3mm 0; padding-inline-start: 6mm; }
  .signoff {
    /* flows right after the letter body instead of pinning to the page
       bottom — a short letter gets its signature close to the text, a
       long one lands wherever the text actually ends. Horizontal margin
       matches .content's padding since there's no page-level margin. */
    margin: 20mm 20mm 0 20mm;
    text-align: left;
    font-size: 12px;
  }
  .signatory-label { font-weight: 700; margin-top: 2mm; }
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
    ${signatoryLabel ? `<div class="signatory-label">${esc(signatoryLabel)}</div>` : ""}
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
    // No PDF-level margin — see the .content comment above for why
    // combining one with a full-page absolutely-positioned image breaks
    // pagination. All spacing is plain CSS padding/margin instead.
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

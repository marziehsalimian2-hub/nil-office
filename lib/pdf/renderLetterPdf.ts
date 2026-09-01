import "server-only";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { PDFDocument } from "pdf-lib";

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

const FONT_FACE = `@font-face {
  font-family: "Vazirmatn";
  src: url(data:font/woff2;base64,${fontBase64()}) format("woff2");
  font-weight: 100 900;
}`;

/**
 * HTML for the letter TEXT only — no letterhead image, no date/number
 * overlay. Those are composited on top of page 1 afterwards (see
 * renderLetterPdf) as a separately-rendered transparent PNG + the raw
 * image, via pdf-lib. Keeping them out of this document means the
 * page.pdf() margin below repeats reliably on every page: mixing a
 * full-page absolutely-positioned image into a margined, paginated flow
 * previously caused Chromium to misplace it and, worse, spilled a
 * one-paragraph letter onto a spurious page 2.
 */
function buildLetterHtml(input: LetterPdfInput): string {
  const { recipientLabel, subject, bodyHtml, signatoryLabel, stampDataUri, signatureDataUri } = input;

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
    line-height: 1.3;
  }
  .recipient { margin-bottom: 4mm; font-weight: 700; }
  .subject { margin-bottom: 8mm; }
  .subject b { text-decoration: underline; }
  .body p { margin: 0 0 3mm 0; }
  .body ul, .body ol { margin: 0 0 3mm 0; padding-inline-start: 6mm; }
  /* A plain (non-atomic) spacer, kept OUTSIDE the break-avoid block below
     on purpose: if the signoff has to move to a new page, this empty box
     is free to be cut off at the page boundary — its remainder (if any)
     is just blank space at the very top of the next page, not a second
     full gap stacked on top of the page's own top margin. A margin
     on .signoff itself does not get discarded when it becomes the first
     box on a new page, so it produced exactly that double-gap bug. */
  .signoff-spacer { height: 8mm; }
  .signoff {
    /* flows right after the letter body instead of pinning to the page
       bottom — a short letter gets its signature close to the text, a
       long one lands wherever the text actually ends. */
    text-align: left;
    font-size: 12px;
    /* tighter than the body's line-height:2 — that was inherited here too,
       so each signatory-label line carried a lot of built-in whitespace
       below its own text before the stamp-row's margin even started. */
    line-height: 1.3;
    /* Without this, when the signoff doesn't fully fit in the remaining
       space on a page, Chromium's print pagination can split it —
       leaving the name/title text on one page and pushing just the large
       stamp-row image to the next, landing far away from its own label.
       Keep the whole block atomic: fits here entirely, or moves entirely. */
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .signatory-label { font-weight: 700; }
  .signatory-label div { margin-top: 1mm; }
  .stamp-row {
    position: relative;
    display: inline-block;
    width: 42mm;
    /* tall enough to fully contain the signature's absolute box (bottom:
       13mm + max-height 20mm = 33mm) so it never overflows the container
       into the label above — avoids needing a large margin-top as a
       buffer, which was reading as a big empty gap. */
    height: 33mm;
    margin-top: 0;
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
    /* drawn after .stamp in the DOM (see below) so it stacks on top
       where the two overlap */
    position: absolute;
    bottom: 13mm;
    right: 0;
    max-width: 48mm;
    max-height: 20mm;
  }
</style>
</head>
<body>
  ${recipientLabel ? `<div class="recipient">گیرنده: ${esc(recipientLabel)}</div>` : ""}
  ${subject ? `<div class="subject">موضوع: <b>${esc(subject)}</b></div>` : ""}
  <div class="body">${bodyHtml}</div>
  <div class="signoff-spacer"></div>
  <div class="signoff">
    ${
      signatoryLabel
        ? `<div class="signatory-label">${signatoryLabel
            .split("\n")
            .map((line) => `<div>${esc(line)}</div>`)
            .join("")}</div>`
        : ""
    }
    <div class="stamp-row">
      ${stampDataUri ? `<img class="stamp" src="${stampDataUri}" />` : ""}
      ${signatureDataUri ? `<img class="signature" src="${signatureDataUri}" />` : ""}
    </div>
  </div>
</body>
</html>`;
}

/** Small transparent snippet with just the date/number, rendered by
 * Chromium so Persian text shaping (letter joining, digit forms) is
 * correct — pdf-lib's own text drawing can't shape Arabic-script text. */
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

export async function renderLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let textPdfBytes: Uint8Array;
  let headerPng: Uint8Array | null = null;
  try {
    const page = await browser.newPage();
    await page.setContent(buildLetterHtml(input), { waitUntil: "load" });
    // Plain text only here (see buildLetterHtml) — no images or overlays
    // to fight with these margins, so they repeat correctly on every
    // generated page, including page 2/3+ for a long letter.
    textPdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "60mm", bottom: "48mm", left: "20mm", right: "20mm" },
    });

    if (input.letterheadDataUri) {
      headerPng = await renderHeaderFieldsPng(browser, input.dateLabel, input.displayNumber);
    }
  } finally {
    await browser.close();
  }

  // Composite the letterhead image + date/number onto page 1 only,
  // underneath the already-rendered text, using pdf-lib. This sidesteps
  // Chromium's print engine entirely for the branding artwork, so there
  // is no more fighting between a fixed-size background image and the
  // page margins used for the actual letter text above.
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

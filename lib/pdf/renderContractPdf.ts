import "server-only";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { PDFDocument } from "pdf-lib";

export type ContractPdfInput = {
  displayNumber: string | null;
  dateLabel: string; // already-formatted Jalali date label for the header overlay
  recipientLabel: string | null; // counterparty company name, shown above the body like a letter's recipient
  subject: string; // contract title
  bodyHtml: string; // the contract's own description text, already converted to safe paragraph HTML
  counterpartyLabel: string | null; // counterparty company name, right (first) signoff column
  counterpartyRepresentativeName: string | null; // typed once in the app, printed instead of a blank line
  nilSignatoryName: string | null; // signatory's full name, left (NIL) signoff column
  nilSignatoryTitle: string | null; // signatory's job title, left (NIL) signoff column
  nilDateLabel: string | null; // approval date shown under NIL's signature
  letterheadDataUri: string | null;
  stampDataUri: string | null;
  signatureDataUri: string | null;
};

// Kept self-contained (rather than importing from renderLetterPdf.ts) because
// contracts need a bilateral (both-parties) signoff table that correspondence
// never does — same reasoning the codebase already uses for validation
// helpers duplicated between lib/validation.ts and lib/validation-accounting.ts.
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

const NIL_LEGAL_NAME = "شرکت مدیریت راهبردی نیل";

/**
 * Body text only, plus a two-column "محل امضا و تأیید قرارداد" table —
 * right column for the counterparty (left blank for their own hand-written
 * signature/stamp, since they're not a system user), left column for NIL
 * (auto-filled: signatory's title, stamp, signature image, approval date).
 * No letterhead image or date/number overlay here — composited afterwards,
 * same reasoning as renderLetterPdf.ts.
 */
function buildContractHtml(input: ContractPdfInput): string {
  const {
    recipientLabel, subject, bodyHtml, counterpartyLabel, counterpartyRepresentativeName,
    nilSignatoryName, nilSignatoryTitle, nilDateLabel, stampDataUri, signatureDataUri,
  } = input;

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
    line-height: 2;
  }
  .recipient { margin-bottom: 4mm; font-weight: 700; }
  .subject { margin-bottom: 8mm; }
  .subject b { text-decoration: underline; }
  .body p { margin: 0 0 3mm 0; }
  .body ul, .body ol { margin: 0 0 3mm 0; padding-inline-start: 6mm; }

  .signoff-heading { margin-top: 10mm; margin-bottom: 4mm; font-size: 13px; font-weight: 700; text-align: center; }
  /* A flat 2-column grid with each field as its own row (not two independent
     text columns) so corresponding fields — most importantly the two "تاریخ"
     rows — line up at the same height on both sides, regardless of the
     stamp/signature block's extra height on the NIL side. */
  .signoff-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10mm; row-gap: 3mm; font-size: 12px; align-items: start; }
  .party-label { font-weight: 700; }
  .stamp-row {
    position: relative;
    width: 42mm;
    /* tall enough to contain the signature's absolute box without overflow */
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
  ${recipientLabel ? `<div class="recipient">طرف قرارداد: ${esc(recipientLabel)}</div>` : ""}
  <div class="subject">موضوع: <b>${esc(subject)}</b></div>
  <div class="body">${bodyHtml}</div>

  <div class="signoff-heading">محل امضا و تأیید قرارداد</div>
  <div class="signoff-grid">
    <div class="party-label">متقاضی/نماینده${counterpartyLabel ? `: ${esc(counterpartyLabel)}` : ""}</div>
    <div class="party-label">مشاور: ${esc(NIL_LEGAL_NAME)}</div>

    <div>نام و نام خانوادگی نماینده: ${counterpartyRepresentativeName ? esc(counterpartyRepresentativeName) : ""}</div>
    <div>نام و نام خانوادگی: ${esc(nilSignatoryName) || "—"}</div>

    <div></div>
    <div>سمت یا عنوان: ${esc(nilSignatoryTitle) || "—"}</div>

    <div>امضا و اثر انگشت/مهر:</div>
    <div>
      امضا و مهر:
      <div class="stamp-row">
        ${stampDataUri ? `<img class="stamp" src="${stampDataUri}" />` : ""}
        ${signatureDataUri ? `<img class="signature" src="${signatureDataUri}" />` : ""}
      </div>
    </div>

    <div>تاریخ:</div>
    <div>تاریخ: ${esc(nilDateLabel) || "—"}</div>
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
      margin: { top: "60mm", bottom: "20mm", left: "20mm", right: "20mm" },
    });

    if (input.letterheadDataUri) {
      headerPng = await renderHeaderFieldsPng(browser, input.dateLabel, input.displayNumber);
    }
  } finally {
    await browser.close();
  }

  // Composite the letterhead image + date/number onto page 1 only,
  // underneath the already-rendered text, using pdf-lib — same approach
  // as renderLetterPdf.ts.
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

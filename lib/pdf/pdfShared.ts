import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "puppeteer";
import { PDFDocument, type PDFPage } from "pdf-lib";

// First shared PDF helper module in this codebase — the three earlier
// renderers (renderContractPdf.ts/renderLetterPdf.ts/renderInvoicePdf.ts)
// each duplicate this ~80 lines of boilerplate by deliberate convention
// ("same reasoning as validation.ts/validation-accounting.ts"), which
// makes sense for three structurally similar signoff-style documents.
// The Client Service Report renderer is a different scale of thing (up
// to 22 conditional sections vs. a handful of fixed blocks), so a
// fourth full copy is a worse trade here. This module is used ONLY by
// lib/pdf/renderClientServiceReportPdf.ts — the three existing
// renderers are left untouched to avoid any regression risk to
// already-shipped, live PDF flows.

export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
export const MM_TO_PT = A4_WIDTH_PT / 210;
export const PX_TO_PT = 0.75; // CSS px (96dpi) -> PDF points (72dpi)

export const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
export const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

export function dataUriToBytes(dataUri: string): { bytes: Uint8Array; isJpg: boolean } {
  const [meta, b64] = dataUri.split(",");
  return { bytes: Buffer.from(b64, "base64"), isJpg: /jpeg|jpg/i.test(meta) };
}

const fontCache = new Map<string, string>();
/** Reads app/fonts/<fileName>, base64-encodes, caches by file name (module-level, mirrors the existing per-renderer cachedFontBase64 pattern). */
export function loadFontBase64(fileName: string): string {
  const cached = fontCache.get(fileName);
  if (cached) return cached;
  const fontPath = path.join(process.cwd(), "app", "fonts", fileName);
  const b64 = fs.readFileSync(fontPath).toString("base64");
  fontCache.set(fileName, b64);
  return b64;
}

/** Renders a small standalone HTML snippet to a transparent PNG via Chromium — Persian text shaping requires Chromium, pdf-lib's own text drawing can't shape Arabic-script text (same reasoning as the existing renderHeaderFieldsPng helpers). */
export async function renderSnippetPng(browser: Browser, html: string, widthPx: number, heightPx: number, deviceScaleFactor = 3): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: widthPx, height: heightPx, deviceScaleFactor });
    await page.setContent(html, { waitUntil: "load" });
    return await page.screenshot({ type: "png", omitBackground: true });
  } finally {
    await page.close();
  }
}

/**
 * Generalizes the existing page-1-only pdf-lib compositing loop to every
 * output page — the proven technique (vs. Puppeteer's untested
 * displayHeaderFooter) for a repeating header/footer with correct
 * Persian text shaping (spec §52 — "Page X of Y", repeating branding).
 * `drawPage` is called once per output page, before the Chromium-
 * rendered text content is drawn on top, so overlays (letterhead
 * background, per-page footer) sit underneath the real content.
 */
export async function compositePdfPages(
  textPdfBytes: Uint8Array,
  drawPage: (outDoc: PDFDocument, outPage: PDFPage, pageIndex: number, pageCount: number) => Promise<void>,
): Promise<Buffer> {
  const textDoc = await PDFDocument.load(textPdfBytes);
  const pageCount = textDoc.getPageCount();

  const outDoc = await PDFDocument.create();
  const embeddedTextPages = await outDoc.embedPdf(textPdfBytes, Array.from({ length: pageCount }, (_, i) => i));

  for (let i = 0; i < pageCount; i++) {
    const outPage = outDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    await drawPage(outDoc, outPage, i, pageCount);
    outPage.drawPage(embeddedTextPages[i], { x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
  }

  const finalBytes = await outDoc.save();
  return Buffer.from(finalBytes);
}

export async function drawFullPageBackground(outDoc: PDFDocument, outPage: PDFPage, dataUri: string) {
  const { bytes, isJpg } = dataUriToBytes(dataUri);
  const img = isJpg ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes);
  outPage.drawImage(img, { x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
}

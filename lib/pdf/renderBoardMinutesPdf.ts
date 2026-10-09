import "server-only";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { rgb } from "pdf-lib";
import { A4_HEIGHT_PT, A4_WIDTH_PT, MM_TO_PT, PX_TO_PT, compositePdfPages, esc, loadFontBase64, renderSnippetPng } from "@/lib/pdf/pdfShared";
import {
  GOLD, NAVY, boardMinutesFooterLabel, boardMinutesRunningHeader, buildBoardMinutesHtml,
} from "@/lib/pdf/boardMinutesHtml";
import type { MinutesDoc } from "@/lib/board/types";

/**
 * Board minutes PDF: Chromium renders the body (Persian shaping), pdf-lib adds the running header (pages 2..n), a gold hairline and the
 * page footer on every page (pdfShared.compositePdfPages — the proven technique, not Puppeteer's displayHeaderFooter).
 * NIL Verify: instead of widening the bottom margin of EVERY page, `minBottomMarginMm` is honoured by an empty reserve kept inside the
 * (unbreakable) signature block, so the last page always has a free corner for the QR plate under the signatures.
 */
const PAGE_MARGIN = { top: 21, bottom: 22, side: 16 };   // mm
const FOOTER_W_PX = 520;
const FOOTER_H_PX = 22;
const HEADER_W_PX = Math.round(((210 - 2 * PAGE_MARGIN.side) * 96) / 25.4);
const HEADER_H_PX = 22;

let emblemCache: string | null = null;
function emblemDataUri(): string | null {
  if (emblemCache) return emblemCache;
  try {
    const b64 = fs.readFileSync(path.join(process.cwd(), "lib", "pdf", "assets", "nil-emblem.png")).toString("base64");
    emblemCache = `data:image/png;base64,${b64}`;
    return emblemCache;
  } catch {
    return null;
  }
}

const snippetCss = (nazanin: string) => `
  @font-face { font-family: "BNazanin"; src: url(data:font/ttf;base64,${nazanin}) format("truetype"); }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: "BNazanin", sans-serif; direction: rtl; font-size: 12px; height: 100%; }`;

function footerHtml(nazanin: string, label: string): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8" /><style>${snippetCss(nazanin)}
    body { display: flex; align-items: center; justify-content: center; color: #4b5563; }
  </style></head><body><span>${esc(label)}</span></body></html>`;
}

function headerHtml(nazanin: string, right: string, left: string): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8" /><style>${snippetCss(nazanin)}
    body { display: flex; align-items: center; justify-content: space-between; color: ${NAVY}; font-size: 11.5px; }
    .l { color: ${GOLD}; }
  </style></head><body><span>${esc(right)}</span><span class="l">${esc(left)}</span></body></html>`;
}

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

export async function renderBoardMinutesPdf(input: { doc: MinutesDoc; draft: boolean; minBottomMarginMm?: number }): Promise<Buffer> {
  const nazanin = loadFontBase64("B-Nazanin.ttf");
  const vazir = loadFontBase64("Vazirmatn-Variable.woff2");
  const reserve = Math.max(0, (input.minBottomMarginMm ?? 0) - PAGE_MARGIN.bottom);
  const html = buildBoardMinutesHtml({ doc: input.doc, draft: input.draft, fonts: { nazanin, vazir }, emblemDataUri: emblemDataUri(), reserveBottomMm: reserve });
  const running = boardMinutesRunningHeader(input.doc);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const textPdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: `${PAGE_MARGIN.top}mm`, bottom: `${PAGE_MARGIN.bottom}mm`, left: `${PAGE_MARGIN.side}mm`, right: `${PAGE_MARGIN.side}mm` },
    });
    const headerPng = await renderSnippetPng(browser, headerHtml(nazanin, running.right, running.left), HEADER_W_PX, HEADER_H_PX);

    return await compositePdfPages(textPdf, async (outDoc, outPage, i, n) => {
      const left = PAGE_MARGIN.side * MM_TO_PT;
      const right = A4_WIDTH_PT - PAGE_MARGIN.side * MM_TO_PT;
      // footer: a short centred gold rule + centred label (kept clear of the bottom-left corner, where the NIL Verify plate goes)
      const fy = 15 * MM_TO_PT;
      const half = 25 * MM_TO_PT;
      outPage.drawLine({ start: { x: A4_WIDTH_PT / 2 - half, y: fy }, end: { x: A4_WIDTH_PT / 2 + half, y: fy }, thickness: 0.6, color: hex(GOLD) });
      const footerPng = await renderSnippetPng(browser, footerHtml(nazanin, boardMinutesFooterLabel(input.doc, input.draft, i, n)), FOOTER_W_PX, FOOTER_H_PX);
      const f = await outDoc.embedPng(footerPng);
      const fw = FOOTER_W_PX * PX_TO_PT;
      const fh = FOOTER_H_PX * PX_TO_PT;
      outPage.drawImage(f, { x: (A4_WIDTH_PT - fw) / 2, y: 8 * MM_TO_PT, width: fw, height: fh });
      // running header from page 2 on (page 1 carries the full title block)
      if (i > 0) {
        const h = await outDoc.embedPng(headerPng);
        const hw = HEADER_W_PX * PX_TO_PT;
        const hh = HEADER_H_PX * PX_TO_PT;
        const hy = A4_HEIGHT_PT - 13 * MM_TO_PT;
        outPage.drawImage(h, { x: left, y: hy, width: hw, height: hh });
        outPage.drawLine({ start: { x: left, y: hy - 1.5 }, end: { x: right, y: hy - 1.5 }, thickness: 0.6, color: hex(GOLD) });
      }
      // thin navy frame band at the very top of every page — a quiet brand accent
      outPage.drawRectangle({ x: 0, y: A4_HEIGHT_PT - 2.2 * MM_TO_PT, width: A4_WIDTH_PT, height: 2.2 * MM_TO_PT, color: hex(NAVY) });
      outPage.drawRectangle({ x: 0, y: A4_HEIGHT_PT - 2.9 * MM_TO_PT, width: A4_WIDTH_PT, height: 0.7 * MM_TO_PT, color: hex(GOLD) });
    });
  } finally {
    await browser.close();
  }
}

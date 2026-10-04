import "server-only";
import puppeteer from "puppeteer";
import {
  A4_WIDTH_PT,
  MM_TO_PT,
  PX_TO_PT,
  faDigits,
  loadFontBase64,
  renderSnippetPng,
  compositePdfPages,
  drawFullPageBackground,
} from "@/lib/pdf/pdfShared";
import { buildPayslipHtml, type PayslipHtmlInput } from "@/lib/pdf/payslipHtml";

export type PayslipPdfInput = PayslipHtmlInput & { letterheadDataUri: string | null };

function footerHtml(fontBase64: string, pageIndex: number, pageCount: number): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8" /><style>
    @font-face { font-family: "BNazanin"; src: url(data:font/ttf;base64,${fontBase64}) format("truetype"); font-weight: 400 700; }
    html, body { margin:0; padding:0; background: transparent; }
    body { font-family: "BNazanin", sans-serif; direction: rtl; color:#666; font-size:10px; display:flex; justify-content:center; align-items:center; height:100%; }
  </style></head><body><span>صفحهٔ ${faDigits(pageIndex + 1)} از ${faDigits(pageCount)}</span></body></html>`;
}

const FOOTER_WIDTH_PX = 300;
const FOOTER_HEIGHT_PX = 24;

/** Renders ONE payslip PDF (A4, RTL, B-Nazanin, optional letterhead). The caller archives the bytes — nothing is regenerated silently. */
export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  const font = loadFontBase64("B-Nazanin.ttf");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildPayslipHtml(input, font), { waitUntil: "load" });
    const textPdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: input.letterheadDataUri ? "45mm" : "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
    });
    return await compositePdfPages(textPdfBytes, async (outDoc, outPage, pageIndex, pageCount) => {
      if (input.letterheadDataUri) await drawFullPageBackground(outDoc, outPage, input.letterheadDataUri);
      const footerPng = await renderSnippetPng(browser, footerHtml(font, pageIndex, pageCount), FOOTER_WIDTH_PX, FOOTER_HEIGHT_PX);
      const embedded = await outDoc.embedPng(footerPng);
      const w = FOOTER_WIDTH_PX * PX_TO_PT;
      const h = FOOTER_HEIGHT_PX * PX_TO_PT;
      outPage.drawImage(embedded, { x: (A4_WIDTH_PT - w) / 2, y: 8 * MM_TO_PT, width: w, height: h });
    });
  } finally {
    await browser.close();
  }
}

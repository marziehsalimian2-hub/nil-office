import "server-only";
import puppeteer from "puppeteer";
import { PDFDocument, rgb } from "pdf-lib";
import { loadFontBase64, esc } from "@/lib/pdf/pdfShared";
import { computePlate, plateFitsPage, LABEL_LINE_MM } from "./layout";
import { qrPng } from "./qr";
import type { VerifyLayout } from "./types";

/**
 * Overlays the verification plate (QR + label + code) on an ALREADY-rendered PDF with pdf-lib. The existing renderers are not
 * touched: they produce the document, this step adds the plate, and the SHA-256 is computed on the bytes this function returns —
 * the QR therefore exists BEFORE the hash, and the stored file is never re-rendered afterwards (no hash <-> QR cycle).
 */

/** Persian label + Latin code rendered by Chromium (pdf-lib cannot shape Arabic-script text), transparent PNG, auto-shrunk to fit the plate width. */
export async function renderVerifyLabelPng(opts: {
  label: string | null; code: string | null; widthMm: number; lineMm?: number;
}): Promise<Uint8Array> {
  const lineMm = opts.lineMm ?? LABEL_LINE_MM;
  const lines = (opts.label ? 1 : 0) + (opts.code ? 1 : 0);
  const pxPerMm = 96 / 25.4;
  const w = Math.round(opts.widthMm * pxPerMm);
  const h = Math.round(lines * lineMm * pxPerMm);
  const lineH = Math.round(lineMm * pxPerMm);
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8" /><style>
  @font-face { font-family: "B Nazanin"; src: url(data:font/ttf;base64,${loadFontBase64("B-Nazanin.ttf")}) format("truetype"); }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: ${w}px; font-family: "B Nazanin", sans-serif; color: #111; text-align: center; }
  .l { height: ${lineH}px; line-height: ${lineH}px; white-space: nowrap; overflow: hidden; font-size: 11px; }
  .code { direction: ltr; font-family: Consolas, "Courier New", monospace; letter-spacing: 0.3px; font-weight: 700; }
</style></head><body>
  ${opts.label ? `<div class="l fit">${esc(opts.label)}</div>` : ""}
  ${opts.code ? `<div class="l fit code">${esc(opts.code)}</div>` : ""}
</body></html>`;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 4 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.querySelectorAll<HTMLElement>(".fit").forEach((el) => {
        let size = 11;
        while (el.scrollWidth > el.clientWidth && size > 6) { size -= 0.5; el.style.fontSize = `${size}px`; }
      });
    });
    return new Uint8Array(await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }));
  } finally {
    await browser.close();
  }
}

export type StampOptions = {
  url: string;
  code: string;
  layout: VerifyLayout;
  /** test hook: a pre-rendered label PNG (skips Chromium) */
  labelPng?: Uint8Array | null;
};

export type StampResult = { bytes: Buffer; pageIndex: number; pageCount: number };

export async function stampVerificationQr(pdfBytes: Uint8Array, opts: StampOptions): Promise<StampResult> {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  const pageIndex = opts.layout.page === "FIRST" ? 0 : pages.length - 1;
  const page = pages[pageIndex];
  const { width, height } = page.getSize();
  if (!plateFitsPage(opts.layout, width, height)) throw new Error("VERIFY_LAYOUT_OUT_OF_PAGE");
  const g = computePlate(opts.layout);

  const qr = await doc.embedPng(await qrPng(opts.url));
  page.drawRectangle({ x: g.plate.x, y: g.plate.y, width: g.plate.w, height: g.plate.h, color: rgb(1, 1, 1), borderColor: rgb(0.78, 0.78, 0.78), borderWidth: 0.5 });
  page.drawImage(qr, { x: g.qr.x, y: g.qr.y, width: g.qr.size, height: g.qr.size });

  if (g.text) {
    const png = opts.labelPng ?? (await renderVerifyLabelPng({
      label: opts.layout.show_label ? opts.layout.label_text : null,
      code: opts.layout.show_code ? opts.code : null,
      widthMm: g.text.w / (595.28 / 210),
    }));
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: g.text.x, y: g.text.y, width: g.text.w, height: g.text.h });
  }
  return { bytes: Buffer.from(await doc.save()), pageIndex, pageCount: pages.length };
}

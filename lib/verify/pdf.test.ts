import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { PDFDocument } from "pdf-lib";
import jsQR from "jsqr";
import sharp from "sharp";
import { renderLetterPdf } from "@/lib/pdf/renderLetterPdf";
import { renderInvoicePdf } from "@/lib/pdf/renderInvoicePdf";
import { renderContractPdf } from "@/lib/pdf/renderContractPdf";
import { renderBoardMinutesPdf } from "@/lib/pdf/renderBoardMinutesPdf";
import { stampVerificationQr } from "./stamp";
import { plateTopMm } from "./layout";
import { generateVerifyToken, sha256Hex } from "./token";
import { buildVerifyUrl } from "./format";
import type { VerifyLayout } from "./types";

/**
 * REAL end-to-end PDF checks (Chromium renders the actual documents with the production renderers and real fonts):
 *   document -> overlay QR -> freeze -> SHA-256 -> the QR in the final file is SCANNED (jsQR on a raster of the page) and decodes to the URL;
 *   a one-byte-modified copy mismatches; the stamp touches only its own plate and nothing under it; page size / page count are unchanged.
 * Screenshots are written to the OS temp dir (nil-verify-*.png) for manual inspection.
 */

const LABEL = "استعلام اصالت سند — NIL Verify";
const LAYOUT: Record<string, VerifyLayout> = {
  OUTGOING_CORRESPONDENCE: { page: "LAST", x_mm: 20, y_mm: 8, size_mm: 24, show_label: true, show_code: true, label_text: LABEL },
  PROFORMA: { page: "LAST", x_mm: 18, y_mm: 10, size_mm: 22, show_label: true, show_code: true, label_text: LABEL },
  INVOICE: { page: "LAST", x_mm: 18, y_mm: 10, size_mm: 22, show_label: true, show_code: true, label_text: LABEL },
  CONTRACT: { page: "LAST", x_mm: 20, y_mm: 10, size_mm: 22, show_label: true, show_code: true, label_text: LABEL },
  BOARD_MINUTES: { page: "LAST", x_mm: 14, y_mm: 9, size_mm: 20, show_label: true, show_code: true, label_text: LABEL },
};
const reserve = (t: string) => Math.ceil(plateTopMm(LAYOUT[t]) + 4);

const para = (n: number) => Array.from({ length: n }, (_, i) => `<p>بند ${i + 1}: طرفین متعهد می‌شوند که مفاد این سند را مطابق ضوابط و مقررات و با رعایت کامل حسن نیت اجرا نمایند و هرگونه تغییر را کتباً اعلام کنند.</p>`).join("");

async function renderSample(type: string): Promise<Buffer> {
  const m = reserve(type);
  if (type === "OUTGOING_CORRESPONDENCE") {
    return renderLetterPdf({
      language: "FA", displayNumber: "ص-۱۴۰۵-۰۰۷۰", dateLabel: "۱۴۰۵/۰۷/۱۴", recipientLabel: "شرکت نمونهٔ آزمایشی", subject: "درخواست همکاری",
      bodyHtml: para(6), signatoryLabel: "دکتر نمونه — مدیرعامل", letterheadDataUri: null, stampDataUri: null, signatureDataUri: null, minBottomMarginMm: m,
    });
  }
  if (type === "BOARD_MINUTES") {
    const people = ["رئیس هیئت‌مدیره نمونه", "مرضیه سلیمیان", "عضو داخلی نمونه", "عضو بیرونی اول", "عضو بیرونی دوم"];
    return renderBoardMinutesPdf({
      draft: false, minBottomMarginMm: m,
      doc: {
        meeting: {
          id: "x", number: 12, type: "ORDINARY", scheduled_at: "2026-10-20T06:00:00Z", location: "دفتر نیل", started_at: "2026-10-20T06:05:00Z",
          ended_at: "2026-10-20T07:40:00Z", invitees: "مدیر مالی", general_notes: para(3).replace(/<[^>]+>/g, "\n"), remaining_topics: "بررسی بودجهٔ سال آینده",
        },
        chair: { name: people[0], title: "رئیس هیئت‌مدیره" }, secretary: { name: people[1], title: "دبیر" },
        attendance: people.map((p, i) => ({ member_id: `m${i}`, name: p, title: i === 0 ? "رئیس هیئت‌مدیره" : "عضو", kind: i > 2 ? "EXTERNAL" : "INTERNAL", status: i === 4 ? "EXCUSED" : "PRESENT", note: null })),
        agenda: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, position: i + 1, title: `بند ${i + 1} دستور جلسه`, discussion: para(3).replace(/<[^>]+>/g, "\n") })),
        resolutions: Array.from({ length: 5 }, (_, i) => ({
          id: `r${i}`, number: `12-${i + 1}`, agenda_item_id: null, text: `مصوبهٔ شمارهٔ ${i + 1}: واحد مربوط موظف است گزارش کامل را تهیه و ارائه کند.`, requires_action: i !== 4,
          owner_name: i !== 4 ? people[1] : null, due_date: i !== 4 ? "2026-11-01" : null, expected_output: i !== 4 ? "گزارش مکتوب" : null, vote_note: i === 0 ? "با اتفاق آرا" : null,
        })),
        previous_followups: [{ number: "11-2", text: "پیگیری قرارداد بیمه", owner_name: people[0], due_date: "2026-10-10", follow_status: "IN_PROGRESS" }],
        approved_at: "2026-10-20T09:00:00Z", approved_by_name: people[1], next_meeting: { scheduled_at: "2026-11-03T06:00:00Z", location: "دفتر نیل" },
      },
    });
  }
  if (type === "CONTRACT") {
    return renderContractPdf({
      displayNumber: "ق-۱۴۰۵-۰۰۰۴", dateLabel: "۱۴۰۵/۰۷/۱۴", recipientLabel: "شرکت طرف قرارداد", subject: "قرارداد خدمات مشاوره",
      bodyHtml: para(34), counterpartyLabel: "شرکت طرف قرارداد", counterpartyRepresentativeName: "آقای نمونه", nilSignatoryName: "دکتر نمونه",
      nilSignatoryTitle: "مدیرعامل", letterheadDataUri: null, stampDataUri: null, signatureDataUri: null, minBottomMarginMm: m,
    });
  }
  return renderInvoicePdf({
    language: "FA", displayNumber: type === "PROFORMA" ? "پ-۱۴۰۵-۰۰۰۵" : "ف-۱۴۰۵-۰۰۱۱", dateLabel: "۱۴۰۵/۰۷/۱۴",
    docTypeLabel: type === "PROFORMA" ? "پیش‌فاکتور" : "فاکتور", title: "فاکتور", customerLegalName: "شرکت مشتری نمونه", customerEnglishName: null,
    customerRegistrationNumber: null, customerNationalId: null, customerEconomicCode: null, customerAddress: "تهران", customerContactPerson: null, customerPhone: null,
    contractLabel: null,
    items: Array.from({ length: 4 }, (_, i) => ({
      description: `خدمات شمارهٔ ${i + 1}`, itemTypeLabel: "خدمت", quantityLabel: "۱", unit: "عدد", unitPriceLabel: "۱٬۰۰۰٬۰۰۰", discountLabel: "۰", taxLabel: "۰", lineTotalLabel: "۱٬۰۰۰٬۰۰۰",
    })),
    currencyLabel: "ریال", subtotalLabel: "۴٬۰۰۰٬۰۰۰", discountLabel: "۰", taxLabel: "۰", totalLabel: "۴٬۰۰۰٬۰۰۰", paymentTerms: null, notes: null,
    bankName: null, bankAccountTitle: null, bankAccountNumber: null, bankIban: null, nilSignatoryName: "دکتر نمونه", nilSignatoryTitle: "مدیرعامل",
    letterheadDataUri: null, stampDataUri: null, signatureDataUri: null, minBottomMarginMm: m,
  });
}

let browser: Browser;
beforeAll(async () => {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Raster of one PDF page through Chromium's built-in viewer. */
async function raster(bytes: Uint8Array, pageNo: number, tag: string) {
  const f = path.join(os.tmpdir(), `nil-verify-${tag}.pdf`);
  fs.writeFileSync(f, bytes);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1250, deviceScaleFactor: 2 });
    await page.goto(`file:///${f.split(path.sep).join("/")}#page=${pageNo}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`, { waitUntil: "networkidle0", timeout: 30_000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2500));
    const shot = Buffer.from(await page.screenshot({ type: "png" }));
    fs.writeFileSync(path.join(os.tmpdir(), `nil-verify-${tag}.png`), shot);
    const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } finally {
    await page.close();
  }
}

describe.each(["OUTGOING_CORRESPONDENCE", "PROFORMA", "INVOICE", "CONTRACT", "BOARD_MINUTES"])("real %s PDF", (type) => {
  it("QR is stamped on the final page, scans to the URL, the hash matches, a modified copy mismatches, nothing underneath is covered", async () => {
    const original = await renderSample(type);
    const token = generateVerifyToken();
    const url = buildVerifyUrl("https://office.example.com", token);
    const stamped = await stampVerificationQr(original, { url, code: "NIL-V-ABCD-2345", layout: LAYOUT[type] });

    // structure: same number of pages, same page size, stamp on the configured (last) page
    const a = await PDFDocument.load(original);
    const b = await PDFDocument.load(stamped.bytes);
    expect(b.getPageCount()).toBe(a.getPageCount());
    expect(stamped.pageIndex).toBe(a.getPageCount() - 1);
    for (let i = 0; i < a.getPageCount(); i++) {
      expect(b.getPage(i).getSize()).toEqual(a.getPage(i).getSize());
    }
    if (type === "CONTRACT" || type === "BOARD_MINUTES") expect(a.getPageCount()).toBeGreaterThanOrEqual(2);   // the multi-page case

    // hash lifecycle: the hash is of the EXACT final bytes; any change mismatches
    const hash = sha256Hex(stamped.bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(stamped.bytes)).toBe(hash);                       // exact copy -> match
    expect(sha256Hex(original)).not.toBe(hash);                        // the QR changed the file, so the hash must be taken AFTER stamping
    const tampered = Buffer.from(stamped.bytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    expect(sha256Hex(tampered)).not.toBe(hash);                        // one flipped bit -> mismatch

    // scan the QR from a raster of the final page
    const pageNo = stamped.pageIndex + 1;
    const after = await raster(stamped.bytes, pageNo, `${type}-stamped`);
    const decoded = jsQR(new Uint8ClampedArray(after.data), after.width, after.height);
    expect(decoded?.data, "QR must decode to the verification URL").toBe(url);

    // the stamp only changed its own plate, and that area was empty before (no text / signature / stamp covered)
    const before = await raster(original, pageNo, `${type}-original`);
    expect(before.width).toBe(after.width);
    let minX = after.width, minY = after.height, maxX = -1, maxY = -1;
    for (let y = 0; y < after.height; y++) {
      for (let x = 0; x < after.width; x++) {
        const i = (y * after.width + x) * 4;
        if (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2]) > 30) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    expect(maxX, "the stamp must change some pixels").toBeGreaterThan(minX);
    // ... confined to the lower-left part of the page (default layout) ...
    expect(maxX - minX).toBeLessThan(after.width * 0.4);
    expect(maxY - minY).toBeLessThan(after.height * 0.25);
    expect(minY).toBeGreaterThan(after.height * 0.6);
    // ... and the original had NO content in that rectangle (every pixel background-coloured)
    let busy = 0;
    const ref = [before.data[((minY - 6) * before.width + (minX + 6)) * 4], before.data[((minY - 6) * before.width + (minX + 6)) * 4 + 1], before.data[((minY - 6) * before.width + (minX + 6)) * 4 + 2]];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * before.width + x) * 4;
        if (Math.abs(before.data[i] - ref[0]) + Math.abs(before.data[i + 1] - ref[1]) + Math.abs(before.data[i + 2] - ref[2]) > 40) busy++;
      }
    }
    expect(busy, "pixels of the original that the plate would cover").toBe(0);
  }, 180_000);
});

describe("stamp guards", () => {
  it("refuses a layout that falls off the page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    await expect(stampVerificationQr(await doc.save(), { url: `https://x.com/verify/${"A".repeat(43)}`, code: "NIL-V-ABCD-2345", layout: { ...LAYOUT.INVOICE, x_mm: 200 } })).rejects.toThrow("VERIFY_LAYOUT_OUT_OF_PAGE");
  });
  it("FIRST places the stamp on page one of a multi-page document", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]); doc.addPage([595.28, 841.89]); doc.addPage([595.28, 841.89]);
    const r = await stampVerificationQr(await doc.save(), { url: `https://x.com/verify/${"A".repeat(43)}`, code: "NIL-V-ABCD-2345", layout: { ...LAYOUT.INVOICE, page: "FIRST", show_label: false, show_code: false }, labelPng: null });
    expect(r.pageIndex).toBe(0);
    expect(r.pageCount).toBe(3);
  });
});

import "server-only";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { PDFDocument } from "pdf-lib";

export type InvoiceItemInput = {
  description: string;
  itemTypeLabel: string;
  quantityLabel: string;
  unit: string | null;
  unitPriceLabel: string;
  discountLabel: string;
  taxLabel: string;
  lineTotalLabel: string;
};

export type InvoicePdfInput = {
  language: "FA" | "EN";
  displayNumber: string | null;
  dateLabel: string; // already-formatted Jalali date label for the header overlay
  docTypeLabel: string; // "پیش‌فاکتور" | "فاکتور"
  title: string; // e.g. display number or "پیش‌نویس"

  customerLegalName: string;
  customerEnglishName: string | null;
  customerRegistrationNumber: string | null;
  customerNationalId: string | null;
  customerEconomicCode: string | null;
  customerAddress: string | null;
  customerContactPerson: string | null;
  customerPhone: string | null;

  contractLabel: string | null; // linked contract's display line, if any

  items: InvoiceItemInput[];
  currencyLabel: string;
  subtotalLabel: string;
  discountLabel: string;
  taxLabel: string;
  totalLabel: string;

  paymentTerms: string | null;
  notes: string | null;

  bankName: string | null;
  bankAccountTitle: string | null;
  bankAccountNumber: string | null;
  bankIban: string | null;

  nilSignatoryName: string | null;
  nilSignatoryTitle: string | null;

  letterheadDataUri: string | null;
  stampDataUri: string | null;
  signatureDataUri: string | null;
};

// Kept self-contained (rather than importing from renderContractPdf.ts) —
// same reasoning the codebase already uses for validation helpers
// duplicated between lib/validation.ts and lib/validation-accounting.ts.
let cachedFontBase64: string | null = null;
function fontBase64(): string {
  if (cachedFontBase64) return cachedFontBase64;
  const fontPath = path.join(process.cwd(), "app", "fonts", "Vazirmatn-Variable.woff2");
  cachedFontBase64 = fs.readFileSync(fontPath).toString("base64");
  return cachedFontBase64;
}

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

const FONT_FACE = `@font-face {
  font-family: "Vazirmatn";
  src: url(data:font/woff2;base64,${fontBase64()}) format("woff2");
  font-weight: 100 900;
}`;

const NIL_LEGAL_NAME: Record<"FA" | "EN", string> = {
  FA: "شرکت مدیریت راهبردی نیل",
  EN: "NIL Strategic Management Development Co.",
};

// Static labels for the two supported document languages. The structural
// HTML (item table, totals block, signoff grid) stays identical either
// way — only these strings, digit script (handled upstream in
// invoiceData.ts), and dir/text-align (set from `language` below) change.
// Kept as one small table rather than a second template file so this
// session's hard-won pagination fixes (break-inside:avoid, the
// spacer-div technique) never have to be kept in sync in two places.
const LABELS = {
  FA: {
    dir: "rtl" as const,
    customer: "نام مشتری:",
    englishName: "نام لاتین:",
    registrationNumber: "شماره ثبت:",
    nationalId: "شناسه/کد ملی:",
    economicCode: "کد اقتصادی:",
    address: "نشانی:",
    contactPerson: "نماینده/تماس:",
    phone: "تلفن:",
    relatedContract: "مرتبط با قرارداد:",
    col: { no: "ردیف", description: "شرح", type: "نوع", qty: "تعداد", unit: "واحد", unitPrice: "قیمت واحد", discount: "تخفیف", tax: "مالیات", total: "جمع" },
    subtotal: "جمع جزء",
    finalTotal: "مبلغ نهایی",
    paymentTerms: "شرایط پرداخت:",
    bankInfoHeading: "اطلاعات واریز",
    bank: "بانک:",
    bankAccountTitle: "به نام:",
    bankAccountNumber: "شماره حساب:",
    bankIban: "شماره شبا:",
    signoffHeading: "محل امضا و تأیید",
    customerParty: "مشتری",
    nameLabel: "نام و نام خانوادگی:",
    titleLabel: "سمت یا عنوان:",
    signatureLabel: "امضا و مهر:",
  },
  EN: {
    dir: "ltr" as const,
    customer: "Customer:",
    englishName: "English Name:",
    registrationNumber: "Registration No.:",
    nationalId: "National ID:",
    economicCode: "Economic Code:",
    address: "Address:",
    contactPerson: "Contact Person:",
    phone: "Phone:",
    relatedContract: "Related Contract:",
    col: { no: "No.", description: "Description", type: "Type", qty: "Qty", unit: "Unit", unitPrice: "Unit Price", discount: "Discount", tax: "Tax", total: "Total" },
    subtotal: "Subtotal",
    finalTotal: "Total Amount",
    paymentTerms: "Payment Terms:",
    bankInfoHeading: "Payment Details",
    bank: "Bank:",
    bankAccountTitle: "Account Title:",
    bankAccountNumber: "Account Number:",
    bankIban: "IBAN:",
    signoffHeading: "Signature & Approval",
    customerParty: "Customer",
    nameLabel: "Name:",
    titleLabel: "Title:",
    signatureLabel: "Signature & Stamp:",
  },
};

/**
 * Item table + totals + signature — no letterhead image, no date/number
 * overlay (composited afterwards, same reasoning as renderContractPdf.ts).
 * The item table gets its OWN tight line-height — it must NOT inherit the
 * loose line-height:2 tuned for prose letter bodies, which this session
 * already discovered can overflow a page and separate a trailing
 * break-inside:avoid block from the content above it.
 */
function buildInvoiceHtml(input: InvoicePdfInput): string {
  const {
    language, docTypeLabel, title, customerLegalName, customerEnglishName, customerRegistrationNumber,
    customerNationalId, customerEconomicCode, customerAddress, customerContactPerson, customerPhone,
    contractLabel, items, currencyLabel, subtotalLabel, discountLabel, taxLabel, totalLabel,
    paymentTerms, notes, nilSignatoryName, nilSignatoryTitle, stampDataUri, signatureDataUri,
    bankName, bankAccountTitle, bankAccountNumber, bankIban,
  } = input;
  const L = LABELS[language];
  const hasBankInfo = bankName || bankAccountTitle || bankAccountNumber || bankIban;

  const itemRows = items
    .map(
      (it, i) => `
    <tr>
      <td class="c">${language === "EN" ? i + 1 : faDigits(i + 1)}</td>
      <td class="r">${esc(it.description)}</td>
      <td class="c">${esc(it.itemTypeLabel)}</td>
      <td class="c">${esc(it.quantityLabel)}</td>
      <td class="c">${esc(it.unit) || "—"}</td>
      <td class="c">${esc(it.unitPriceLabel)}</td>
      <td class="c">${esc(it.discountLabel)}</td>
      <td class="c">${esc(it.taxLabel)}</td>
      <td class="c">${esc(it.lineTotalLabel)}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${language === "EN" ? "en" : "fa"}" dir="${L.dir}">
<head>
<meta charset="utf-8" />
<style>
  ${FONT_FACE}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Vazirmatn", sans-serif;
    direction: ${L.dir};
    color: #1a1a1a;
    font-size: 12px;
    line-height: 1.6;
  }
  .doc-title { margin-bottom: 6mm; font-size: 15px; font-weight: 700; text-align: center; }
  .doc-title .num { display: block; margin-top: 1mm; font-size: 12px; font-weight: 400; color: #444; }

  .customer-box { margin-bottom: 5mm; border: 0.5pt solid #1a1a1a33; border-radius: 2mm; padding: 3mm 4mm; }
  .customer-box .row { display: flex; gap: 2mm; padding: 0.8mm 0; }
  .customer-box .label { width: 28mm; flex-shrink: 0; color: #555; }
  .contract-ref { margin-bottom: 4mm; font-size: 11px; color: #444; }

  /* Item table — its own tight density, deliberately not inheriting a
     prose line-height. */
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 11px; line-height: 1.3; }
  table.items thead th {
    background: #f2f2ef; border: 0.5pt solid #1a1a1a33; padding: 1.6mm 1.2mm; font-weight: 700; text-align: center;
  }
  table.items td { border: 0.5pt solid #1a1a1a22; padding: 1.6mm 1.2mm; vertical-align: top; }
  table.items td.c { text-align: center; white-space: nowrap; }
  table.items td.r { text-align: right; }

  /* Plain (non-atomic) spacer ahead of each break-avoid block — see
     renderContractPdf.ts's .signoff-spacer for why a margin on the
     avoid-break block itself is the wrong place for this gap. */
  .totals-spacer, .signoff-spacer { height: 4mm; }

  .totals-block { break-inside: avoid; page-break-inside: avoid; }
  .totals-block table { width: 70mm; margin-inline-start: auto; border-collapse: collapse; font-size: 11.5px; }
  .totals-block td { padding: 1.2mm 2mm; }
  .totals-block td.label { color: #555; }
  .totals-block td.value { text-align: left; direction: ltr; }
  .totals-block tr.final td { border-top: 0.5pt solid #1a1a1a55; font-weight: 700; font-size: 13px; padding-top: 2mm; }

  .terms { margin-top: 5mm; font-size: 11px; color: #333; white-space: pre-wrap; }

  .bank-info { margin-top: 5mm; border: 0.5pt solid #1a1a1a33; border-radius: 2mm; padding: 3mm 4mm; font-size: 11px; }
  .bank-info .heading { margin-bottom: 1.5mm; font-weight: 700; }
  .bank-info .row { display: flex; gap: 2mm; padding: 0.6mm 0; }
  .bank-info .label { width: 28mm; flex-shrink: 0; color: #555; }

  .signoff-block { break-inside: avoid; page-break-inside: avoid; }
  .signoff-heading { margin-bottom: 3mm; font-size: 12px; font-weight: 700; text-align: center; }
  .signoff-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10mm; row-gap: 2mm; font-size: 11px; }
  .party-label { font-weight: 700; }
  .stamp-row { position: relative; width: 40mm; height: 30mm; margin-top: 2mm; }
  .stamp-row img.stamp { position: absolute; bottom: 0; left: 0; max-width: 26mm; max-height: 26mm; opacity: 0.9; }
  .stamp-row img.signature { position: absolute; bottom: 12mm; right: 0; max-width: 44mm; max-height: 18mm; }
</style>
</head>
<body>
  <div class="doc-title">
    ${esc(docTypeLabel)}
    <span class="num">${esc(title)}</span>
  </div>

  <div class="customer-box">
    <div class="row"><span class="label">${L.customer}</span><span>${esc(customerLegalName)}</span></div>
    ${customerEnglishName ? `<div class="row"><span class="label">${L.englishName}</span><span>${esc(customerEnglishName)}</span></div>` : ""}
    ${customerRegistrationNumber ? `<div class="row"><span class="label">${L.registrationNumber}</span><span>${esc(customerRegistrationNumber)}</span></div>` : ""}
    ${customerNationalId ? `<div class="row"><span class="label">${L.nationalId}</span><span>${esc(customerNationalId)}</span></div>` : ""}
    ${customerEconomicCode ? `<div class="row"><span class="label">${L.economicCode}</span><span>${esc(customerEconomicCode)}</span></div>` : ""}
    ${customerAddress ? `<div class="row"><span class="label">${L.address}</span><span>${esc(customerAddress)}</span></div>` : ""}
    ${customerContactPerson ? `<div class="row"><span class="label">${L.contactPerson}</span><span>${esc(customerContactPerson)}</span></div>` : ""}
    ${customerPhone ? `<div class="row"><span class="label">${L.phone}</span><span dir="ltr">${esc(customerPhone)}</span></div>` : ""}
  </div>

  ${contractLabel ? `<div class="contract-ref">${L.relatedContract} ${esc(contractLabel)}</div>` : ""}

  <table class="items">
    <thead>
      <tr>
        <th>${L.col.no}</th><th>${L.col.description}</th><th>${L.col.type}</th><th>${L.col.qty}</th><th>${L.col.unit}</th>
        <th>${L.col.unitPrice}</th><th>${L.col.discount}</th><th>${L.col.tax}</th><th>${L.col.total}</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-spacer"></div>
  <div class="totals-block">
    <table>
      <tr><td class="label">${L.subtotal} (${esc(currencyLabel)})</td><td class="value">${esc(subtotalLabel)}</td></tr>
      <tr><td class="label">${L.col.discount}</td><td class="value">${esc(discountLabel)}</td></tr>
      <tr><td class="label">${L.col.tax}</td><td class="value">${esc(taxLabel)}</td></tr>
      <tr class="final"><td class="label">${L.finalTotal}</td><td class="value">${esc(totalLabel)}</td></tr>
    </table>
  </div>

  ${paymentTerms ? `<div class="terms"><b>${L.paymentTerms}</b> ${esc(paymentTerms)}</div>` : ""}
  ${notes ? `<div class="terms">${esc(notes)}</div>` : ""}

  ${hasBankInfo ? `<div class="bank-info">
    <div class="heading">${L.bankInfoHeading}</div>
    ${bankName ? `<div class="row"><span class="label">${L.bank}</span><span>${esc(bankName)}</span></div>` : ""}
    ${bankAccountTitle ? `<div class="row"><span class="label">${L.bankAccountTitle}</span><span>${esc(bankAccountTitle)}</span></div>` : ""}
    ${bankAccountNumber ? `<div class="row"><span class="label">${L.bankAccountNumber}</span><span dir="ltr">${esc(bankAccountNumber)}</span></div>` : ""}
    ${bankIban ? `<div class="row"><span class="label">${L.bankIban}</span><span dir="ltr">${esc(bankIban)}</span></div>` : ""}
  </div>` : ""}

  <div class="signoff-spacer"></div>
  <div class="signoff-block">
    <div class="signoff-heading">${L.signoffHeading}</div>
    <div class="signoff-grid">
      <div class="party-label">${L.customerParty}</div>
      <div class="party-label">${esc(NIL_LEGAL_NAME[language])}</div>

      <div>${L.nameLabel}</div>
      <div>${L.nameLabel} ${esc(nilSignatoryName) || "—"}</div>

      <div></div>
      <div>${L.titleLabel} ${esc(nilSignatoryTitle) || "—"}</div>

      <div>${L.signatureLabel}</div>
      <div>
        ${L.signatureLabel}
        <div class="stamp-row">
          ${stampDataUri ? `<img class="stamp" src="${stampDataUri}" />` : ""}
          ${signatureDataUri ? `<img class="signature" src="${signatureDataUri}" />` : ""}
        </div>
      </div>
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

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let textPdfBytes: Uint8Array;
  let headerPng: Uint8Array | null = null;
  try {
    const page = await browser.newPage();
    await page.setContent(buildInvoiceHtml(input), { waitUntil: "load" });
    textPdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "55mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });

    if (input.letterheadDataUri) {
      headerPng = await renderHeaderFieldsPng(browser, input.dateLabel, input.displayNumber);
    }
  } finally {
    await browser.close();
  }

  // Composite the letterhead image + date/number onto page 1 only,
  // underneath the already-rendered text — same pdf-lib technique as
  // renderContractPdf.ts/renderLetterPdf.ts.
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

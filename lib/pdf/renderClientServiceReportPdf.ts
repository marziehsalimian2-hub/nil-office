import "server-only";
import puppeteer from "puppeteer";
import {
  A4_WIDTH_PT,
  MM_TO_PT,
  PX_TO_PT,
  esc,
  faDigits,
  loadFontBase64,
  renderSnippetPng,
  compositePdfPages,
  drawFullPageBackground,
} from "@/lib/pdf/pdfShared";

export type CurrencyLine = { currencyLabel: string; amount: string };
/** Like CurrencyLine but carries data_complete — renders "اطلاعات کافی برای محاسبه سودآوری وجود ندارد" instead of the amount when false, never a fabricated number (spec's own non-negotiable rule, already shipped identically in ServiceLedgerTab.tsx). */
export type ProfitabilityLine = { currencyLabel: string; amount: string; dataComplete: boolean };
export type TableRow = { cells: string[] };

/**
 * Structured, fully-formatted input — no DB access here, mirrors the
 * existing render*Pdf.ts convention (renderContractPdf.ts etc.) of a
 * pure presentational function. All money/date formatting already
 * happened in lib/pdf/clientServiceReportData.ts.
 *
 * SERVICE_DATE/SERVICE_CATEGORY/SERVICE_DESCRIPTION/SERVICE_PERFORMER
 * (spec §47's own section list) are deliberately folded into
 * SERVICES_PERFORMED's own column set rather than rendered as separate
 * blocks — the spec's §47 (section-level) and §48 (field-level column
 * config) describe the same underlying data from two angles; treating
 * the four as redundant with their §48 field counterparts avoids
 * rendering the same information twice. They remain valid selectable
 * values (nothing breaks if chosen) but produce no extra block here.
 */
export type ClientServiceReportPdfInput = {
  title: string;
  companyName: string;
  periodLabel: string;
  generatedAtLabel: string;
  detailLevelLabel: string;
  introduction: string | null;
  finalNote: string | null;
  customNotes: string | null;
  showLogo: boolean;
  showPageNumbers: boolean;
  letterheadDataUri: string | null;
  /** 'INTERNAL' triggers the confidential banner (cover + footer) — Phase 5. */
  reportFamily: "CLIENT" | "INTERNAL";

  /** Ordered, already filtered to sections that were both selected AND produce content. */
  sectionOrder: string[];

  servicesCountLabel: string;
  servicesColumns: string[];
  servicesRows: TableRow[];

  timeSpentTotalLabel: string | null;

  directExpenseTotals: CurrencyLine[];
  reimbursableExpenseTotals: CurrencyLine[];
  serviceFeeTotals: CurrencyLine[];
  claimableTotals: CurrencyLine[];
  invoicedTotals: CurrencyLine[];
  unbilledTotals: CurrencyLine[];
  receivedTotals: CurrencyLine[];

  /** Phase 5 — Internal Management Report only; empty arrays for a CLIENT-family report. */
  revenueTotals: ProfitabilityLine[];
  internalTimeCostTotals: ProfitabilityLine[];
  reimbursedCostTotals: ProfitabilityLine[];
  unreimbursedCostTotals: ProfitabilityLine[];
  contributionMarginTotals: ProfitabilityLine[];

  contractTitles: string[];
  projectTitles: string[];

  invoicesColumns: string[];
  invoicesRows: TableRow[];

  documentsReferenceLines: string[];

  periodSummaryNote: string;
};

let cachedFontBase64: string | null = null;
function fontBase64(): string {
  if (cachedFontBase64) return cachedFontBase64;
  cachedFontBase64 = loadFontBase64("B-Nazanin.ttf");
  return cachedFontBase64;
}

const FONT_FACE = `@font-face {
  font-family: "BNazanin";
  src: url(data:font/ttf;base64,${fontBase64()}) format("truetype");
  font-weight: 400 700;
}`;

const SECTION_TITLE: Record<string, string> = {
  EXECUTIVE_SUMMARY: "خلاصهٔ مدیریتی",
  SERVICES_PERFORMED: "خدمات انجام‌شده",
  TIME_SPENT: "زمان صرف‌شده",
  CONTRACTS_RELATED: "قراردادهای مرتبط",
  PROJECTS_RELATED: "پروژه‌های مرتبط",
  DIRECT_EXPENSES: "هزینه‌های مستقیم",
  REIMBURSABLE_EXPENSES: "هزینه‌های قابل بازپرداخت",
  SERVICE_FEES: "حق‌الزحمه‌های خدمات",
  CLAIMABLE_AMOUNTS: "مبالغ قابل مطالبه",
  INVOICES_PROFORMAS: "فاکتورها / پیش‌فاکتورها",
  AMOUNTS_RECEIVED: "مبالغ وصول‌شده",
  OUTSTANDING_AMOUNT: "مانده",
  BILLING_SUMMARY: "خلاصهٔ صورتحساب",
  DOCUMENTS_REFERENCE: "ارجاع مستندات",
  PERIOD_SUMMARY: "خلاصهٔ بازه",
  CUSTOM_NOTES: "یادداشت",
  FINAL_SUMMARY: "جمع‌بندی پایانی",
  INTERNAL_TIME_COST: "هزینهٔ داخلی زمان",
  DIRECT_NIL_COST: "هزینهٔ مستقیم NIL",
  REVENUE: "درآمد",
  REIMBURSED_COST: "هزینهٔ بازپرداخت‌شده",
  UNREIMBURSED_COST: "هزینهٔ بازپرداخت‌نشده",
  CONTRIBUTION_MARGIN: "حاشیهٔ مشارکت",
  PROFITABILITY_ANALYSIS: "تحلیل سودآوری",
  INTERNAL_NOTES: "یادداشت داخلی (محرمانه)",
};

function currencyLinesTable(rows: CurrencyLine[]): string {
  if (rows.length === 0) return `<p class="muted">داده‌ای برای این بازه ثبت نشده است.</p>`;
  return `<table class="kv"><tbody>${rows
    .map((r) => `<tr><td class="k">${esc(r.currencyLabel)}</td><td class="v">${esc(r.amount)}</td></tr>`)
    .join("")}</tbody></table>`;
}

function profitabilityLinesTable(rows: ProfitabilityLine[]): string {
  if (rows.length === 0) return `<p class="muted">داده‌ای برای این بازه ثبت نشده است.</p>`;
  return `<table class="kv"><tbody>${rows
    .map((r) =>
      r.dataComplete
        ? `<tr><td class="k">${esc(r.currencyLabel)}</td><td class="v">${esc(r.amount)}</td></tr>`
        : `<tr><td class="k">${esc(r.currencyLabel)}</td><td class="v muted">اطلاعات کافی برای محاسبه وجود ندارد</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function dataTable(columns: string[], rows: TableRow[]): string {
  if (rows.length === 0) return `<p class="muted">رکوردی در این بازه ثبت نشده است.</p>`;
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildSectionHtml(key: string, input: ClientServiceReportPdfInput): string {
  switch (key) {
    case "EXECUTIVE_SUMMARY":
      return `
        <p>${esc(input.servicesCountLabel)}${input.timeSpentTotalLabel ? ` — ${esc(input.timeSpentTotalLabel)}` : ""}</p>
        <div class="grid2">
          <div><p class="sub">حق‌الزحمه‌ها</p>${currencyLinesTable(input.serviceFeeTotals)}</div>
          <div><p class="sub">مبالغ قابل مطالبه</p>${currencyLinesTable(input.claimableTotals)}</div>
          <div><p class="sub">صورتحساب‌شده</p>${currencyLinesTable(input.invoicedTotals)}</div>
          <div><p class="sub">مانده</p>${currencyLinesTable(input.unbilledTotals)}</div>
        </div>`;
    case "SERVICES_PERFORMED":
      return dataTable(input.servicesColumns, input.servicesRows);
    case "TIME_SPENT":
      return `<p>${esc(input.timeSpentTotalLabel ?? "زمانی برای این بازه ثبت نشده است.")}</p>`;
    case "CONTRACTS_RELATED":
      return input.contractTitles.length
        ? `<ul>${input.contractTitles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
        : `<p class="muted">قرارداد مرتبطی ثبت نشده است.</p>`;
    case "PROJECTS_RELATED":
      return input.projectTitles.length
        ? `<ul>${input.projectTitles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
        : `<p class="muted">پروژهٔ مرتبطی ثبت نشده است.</p>`;
    case "DIRECT_EXPENSES":
      return currencyLinesTable(input.directExpenseTotals);
    case "REIMBURSABLE_EXPENSES":
      return currencyLinesTable(input.reimbursableExpenseTotals);
    case "SERVICE_FEES":
      return currencyLinesTable(input.serviceFeeTotals);
    case "CLAIMABLE_AMOUNTS":
      return currencyLinesTable(input.claimableTotals);
    case "INVOICES_PROFORMAS":
      return dataTable(input.invoicesColumns, input.invoicesRows);
    case "AMOUNTS_RECEIVED":
      return `${currencyLinesTable(input.receivedTotals)}<p class="footnote">فقط اسناد بامبلغِ کاملاً وصول‌شده (SETTLED) در این جمع لحاظ شده‌اند.</p>`;
    case "OUTSTANDING_AMOUNT":
      return currencyLinesTable(input.unbilledTotals);
    case "BILLING_SUMMARY":
      return `
        <div class="grid2">
          <div><p class="sub">صورتحساب‌شده</p>${currencyLinesTable(input.invoicedTotals)}</div>
          <div><p class="sub">مانده</p>${currencyLinesTable(input.unbilledTotals)}</div>
        </div>`;
    case "DOCUMENTS_REFERENCE":
      return input.documentsReferenceLines.length
        ? `<ul>${input.documentsReferenceLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
        : `<p class="muted">مستند پیوستی برای این بازه ثبت نشده است.</p>`;
    case "PERIOD_SUMMARY":
      return `<p>${esc(input.periodSummaryNote)}</p>`;
    case "CUSTOM_NOTES":
      return input.customNotes ? `<p class="prose">${esc(input.customNotes).replace(/\n/g, "<br/>")}</p>` : "";
    case "FINAL_SUMMARY":
      return input.finalNote ? `<p class="prose">${esc(input.finalNote).replace(/\n/g, "<br/>")}</p>` : "";
    case "INTERNAL_TIME_COST":
      return profitabilityLinesTable(input.internalTimeCostTotals);
    case "DIRECT_NIL_COST":
      return currencyLinesTable(input.directExpenseTotals);
    case "REVENUE":
      return profitabilityLinesTable(input.revenueTotals);
    case "REIMBURSED_COST":
      return profitabilityLinesTable(input.reimbursedCostTotals);
    case "UNREIMBURSED_COST":
      return profitabilityLinesTable(input.unreimbursedCostTotals);
    case "CONTRIBUTION_MARGIN":
      return profitabilityLinesTable(input.contributionMarginTotals);
    case "PROFITABILITY_ANALYSIS":
      return `
        <div class="grid2">
          <div><p class="sub">درآمد</p>${profitabilityLinesTable(input.revenueTotals)}</div>
          <div><p class="sub">هزینهٔ داخلی زمان</p>${profitabilityLinesTable(input.internalTimeCostTotals)}</div>
          <div><p class="sub">هزینهٔ بازپرداخت‌نشده</p>${profitabilityLinesTable(input.unreimbursedCostTotals)}</div>
          <div><p class="sub">حاشیهٔ مشارکت</p>${profitabilityLinesTable(input.contributionMarginTotals)}</div>
        </div>`;
    case "INTERNAL_NOTES":
      return input.customNotes ? `<p class="prose">${esc(input.customNotes).replace(/\n/g, "<br/>")}</p>` : "";
    default:
      return "";
  }
}

function buildReportHtml(input: ClientServiceReportPdfInput): string {
  const sections = input.sectionOrder
    .filter((k) => k !== "COVER_PAGE" && !["SERVICE_DATE", "SERVICE_CATEGORY", "SERVICE_DESCRIPTION", "SERVICE_PERFORMER"].includes(k))
    .map((k) => {
      const html = buildSectionHtml(k, input);
      if (!html) return "";
      const heading = SECTION_TITLE[k] ?? k;
      return `<section class="block"><h2>${esc(heading)}</h2>${html}</section>`;
    })
    .join("");

  const showCover = input.sectionOrder.includes("COVER_PAGE");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  ${FONT_FACE}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "BNazanin", "Tahoma", sans-serif;
    direction: rtl;
    color: #1a1a1a;
    font-size: 12px;
    line-height: 1.9;
  }
  .cover { text-align: center; padding-top: 40mm; break-after: page; page-break-after: always; }
  .cover .company { font-size: 14px; color: #444; margin-bottom: 8mm; }
  .cover .title { font-size: 20px; font-weight: 700; margin-bottom: 6mm; }
  .cover .client { font-size: 15px; margin-bottom: 3mm; }
  .cover .period { font-size: 13px; color: #444; margin-bottom: 3mm; }
  .cover .generated { font-size: 11px; color: #777; margin-top: 10mm; }
  .cover .confidential { display: inline-block; margin-bottom: 6mm; padding: 1.5mm 4mm; border: 1pt solid #a33; border-radius: 2mm; color: #a33; font-size: 12px; font-weight: 700; }
  .intro { margin-bottom: 5mm; white-space: pre-wrap; }
  .block { break-inside: avoid; page-break-inside: avoid; margin-bottom: 6mm; }
  .block h2 { font-size: 13.5px; font-weight: 700; border-bottom: 0.5pt solid #1a1a1a33; padding-bottom: 1.5mm; margin-bottom: 3mm; }
  .sub { font-weight: 700; margin-bottom: 1.5mm; font-size: 11.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 3mm; }
  table.kv td { padding: 1mm 2mm; border-bottom: 0.5pt solid #1a1a1a1a; }
  table.kv td.k { color: #555; width: 40%; }
  table.kv td.v { text-align: left; direction: ltr; font-weight: 700; }
  table.data { width: 100%; border-collapse: collapse; font-size: 10.5px; line-height: 1.4; margin-bottom: 3mm; }
  table.data thead { display: table-header-group; }
  table.data thead th { background: #f2f2ef; border: 0.5pt solid #1a1a1a33; padding: 1.4mm 1mm; font-weight: 700; text-align: center; }
  table.data td { border: 0.5pt solid #1a1a1a22; padding: 1.4mm 1mm; text-align: center; vertical-align: top; }
  .muted { color: #777; font-size: 11px; }
  .footnote { color: #888; font-size: 9.5px; margin-top: 1mm; }
  .prose { white-space: pre-wrap; }
  ul { margin: 0; padding-inline-start: 5mm; }
</style>
</head>
<body>
  ${showCover ? `
  <div class="cover">
    ${input.reportFamily === "INTERNAL" ? `<div class="confidential">⚠ محرمانه — گزارش مدیریتی داخلی</div><br/>` : ""}
    <div class="company">شرکت مدیریت راهبردی نیل</div>
    <div class="title">${esc(input.title)}</div>
    <div class="client">${esc(input.companyName)}</div>
    <div class="period">${esc(input.periodLabel)}</div>
    <div class="generated">تاریخ تهیه: ${esc(input.generatedAtLabel)} — سطح جزئیات: ${esc(input.detailLevelLabel)}</div>
  </div>` : ""}
  ${input.introduction ? `<p class="intro">${esc(input.introduction).replace(/\n/g, "<br/>")}</p>` : ""}
  ${sections}
</body>
</html>`;
}

/** Small transparent snippet rendered by Chromium so Persian text shaping is correct — same reasoning as the existing renderers' header-field snippets. */
function buildFooterHtml(pageIndex: number, pageCount: number, companyName: string, reportFamily: "CLIENT" | "INTERNAL"): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  ${FONT_FACE}
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: "BNazanin", sans-serif; direction: rtl; color: #666; font-size: 10px; display: flex; justify-content: space-between; align-items: center; height: 100%; padding: 0 4px; }
  .confidential { color: #a33; font-weight: 700; }
</style>
</head>
<body>
  <span${reportFamily === "INTERNAL" ? ` class="confidential"` : ""}>${reportFamily === "INTERNAL" ? "محرمانه — " : ""}${esc(companyName)}</span>
  <span>صفحهٔ ${faDigits(pageIndex + 1)} از ${faDigits(pageCount)}</span>
</body>
</html>`;
}

const FOOTER_WIDTH_PX = 760;
const FOOTER_HEIGHT_PX = 30;

export async function renderClientServiceReportPdf(input: ClientServiceReportPdfInput): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let textPdfBytes: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setContent(buildReportHtml(input), { waitUntil: "load" });
    textPdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: input.showLogo && input.letterheadDataUri ? "45mm" : "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
    });

    const buffer = await compositePdfPages(textPdfBytes, async (outDoc, outPage, pageIndex, pageCount) => {
      if (input.showLogo && input.letterheadDataUri) {
        await drawFullPageBackground(outDoc, outPage, input.letterheadDataUri);
      }
      if (input.showPageNumbers) {
        const footerPng = await renderSnippetPng(browser, buildFooterHtml(pageIndex, pageCount, input.companyName, input.reportFamily), FOOTER_WIDTH_PX, FOOTER_HEIGHT_PX);
        const embedded = await outDoc.embedPng(footerPng);
        const w = FOOTER_WIDTH_PX * PX_TO_PT;
        const h = FOOTER_HEIGHT_PX * PX_TO_PT;
        outPage.drawImage(embedded, { x: (A4_WIDTH_PT - w) / 2, y: 8 * MM_TO_PT, width: w, height: h });
      }
    });

    return buffer;
  } finally {
    await browser.close();
  }
}

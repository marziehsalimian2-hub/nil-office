import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import {
  CURRENCY_LABEL,
  REPORT_FIELD_LABEL,
  REPORT_DETAIL_LEVEL_LABEL,
  SALES_DOCUMENT_TYPE_LABEL,
  SALES_DOCUMENT_STATUS_LABEL,
  BILLING_STATUS_LABEL,
  persianError,
  type Currency,
  type ReportField,
  type ReportDetailLevel,
  type ReportFamily,
} from "@/lib/enums";
import { renderClientServiceReportPdf, type CurrencyLine, type ProfitabilityLine, type TableRow } from "@/lib/pdf/renderClientServiceReportPdf";
import type {
  ClientServiceReportEntryRow,
  ClientServiceReportInvoiceRow,
  ServiceLedgerPeriodSummaryRow,
  ServiceLedgerProfitabilityRow,
} from "@/lib/types/database";

const EXT_TO_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
function extOf(p: string): string {
  return p.slice(p.lastIndexOf(".") + 1).toLowerCase();
}
async function pathToDataUri(supabase: SupabaseClient, storagePath: string | null | undefined): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = EXT_TO_MIME[extOf(storagePath)] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function money(amount: number, currency: string): string {
  return `${formatMoney(amount)} ${CURRENCY_LABEL[currency as Currency] ?? currency}`;
}

function currencyLinesFrom(rows: { currency_code: string; amount: number }[]): CurrencyLine[] {
  return rows.filter((r) => r.amount !== 0).map((r) => ({ currencyLabel: CURRENCY_LABEL[r.currency_code as Currency] ?? r.currency_code, amount: formatMoney(r.amount) }));
}

/** Never renders a fabricated number for a currency whose data_complete=false (mirrors ServiceLedgerTab.tsx's own "اطلاعات کافی برای محاسبه سودآوری وجود ندارد" — same rule, same wording, not a new message for the same concept). */
function profitabilityLinesFrom(rows: { currency_code: string; amount: number; data_complete: boolean }[]): ProfitabilityLine[] {
  return rows.map((r) => ({ currencyLabel: CURRENCY_LABEL[r.currency_code as Currency] ?? r.currency_code, amount: formatMoney(r.amount), dataComplete: r.data_complete }));
}

function durationLabel(minutes: number): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${toFaDigits(h)} ساعت`);
  if (m > 0 || h === 0) parts.push(`${toFaDigits(m)} دقیقه`);
  return parts.join(" و ");
}

export type ReportBuilderParams = {
  client_service_file_id: string;
  report_family: ReportFamily;
  report_type: string;
  period_start: string;
  period_end: string;
  title: string;
  introduction?: string;
  final_note?: string;
  custom_notes?: string;
  selected_sections: string[];
  selected_fields: string[];
  detail_level: ReportDetailLevel;
  show_logo: boolean;
  show_page_numbers: boolean;
};

/**
 * Shared by both the preview route (no archival write) and
 * generateClientServiceReportCore (archival write follows this same
 * build) — one report-building code path, only the "did we persist it"
 * step differs (spec §54's Preview vs Generate separation).
 */
export async function buildClientServiceReportPdf(
  supabase: SupabaseClient,
  params: ReportBuilderParams,
): Promise<{ buffer: Buffer; fileName: string; dataAsOf: string }> {
  const { data: file, error: fileErr } = await supabase
    .from("client_service_files")
    .select("id, company_id, companies(legal_name)")
    .eq("id", params.client_service_file_id)
    .single();
  if (fileErr || !file) throw new Error("پروندهٔ خدمات مشتری یافت نشد.");
  const companyRow = Array.isArray(file.companies) ? file.companies[0] : file.companies;
  const companyName = (companyRow as { legal_name?: string } | null)?.legal_name ?? "—";

  const needsEntries = params.selected_sections.some((s) =>
    ["SERVICES_PERFORMED", "TIME_SPENT", "CONTRACTS_RELATED", "PROJECTS_RELATED", "DIRECT_EXPENSES", "DOCUMENTS_REFERENCE"].includes(s),
  );
  const needsInvoices = params.selected_sections.some((s) => ["INVOICES_PROFORMAS", "AMOUNTS_RECEIVED"].includes(s));
  const needsProfitability =
    params.report_family === "INTERNAL" &&
    params.selected_sections.some((s) =>
      ["INTERNAL_TIME_COST", "DIRECT_NIL_COST", "REVENUE", "REIMBURSED_COST", "UNREIMBURSED_COST", "CONTRIBUTION_MARGIN", "PROFITABILITY_ANALYSIS"].includes(s),
    );

  const [{ data: settings }, { data: summaryData }, { data: entriesData }, { data: invoicesData }, profitabilityRes] = await Promise.all([
    supabase.from("app_settings").select("letterhead_path").eq("id", 1).single(),
    supabase.rpc("get_client_service_period_summary", {
      p_client_service_file_id: params.client_service_file_id,
      p_period_start: params.period_start,
      p_period_end: params.period_end,
    }),
    needsEntries
      ? supabase.rpc("get_client_service_report_entries", {
          p_client_service_file_id: params.client_service_file_id,
          p_period_start: params.period_start,
          p_period_end: params.period_end,
        })
      : Promise.resolve({ data: [] as ClientServiceReportEntryRow[] }),
    needsInvoices
      ? supabase.rpc("get_client_service_report_invoices", {
          p_client_service_file_id: params.client_service_file_id,
          p_period_start: params.period_start,
          p_period_end: params.period_end,
        })
      : Promise.resolve({ data: [] as ClientServiceReportInvoiceRow[] }),
    needsProfitability
      ? supabase.rpc("get_client_service_profitability", {
          p_client_service_file_id: params.client_service_file_id,
          p_period_start: params.period_start,
          p_period_end: params.period_end,
        })
      : Promise.resolve({ data: [] as ServiceLedgerProfitabilityRow[], error: null }),
  ]);

  // get_client_service_profitability is SECURITY DEFINER and raises
  // NOT_AUTHORIZED for anyone lacking can_view_internal_cost() — this
  // is the real authorization backstop for an INTERNAL report (the UI
  // never even offers the option to an unauthorized user, but this is
  // what actually blocks a crafted request).
  if (profitabilityRes.error) throw new Error(persianError(profitabilityRes.error.message));

  const summary = (summaryData ?? []) as ServiceLedgerPeriodSummaryRow[];
  const entries = (entriesData ?? []) as ClientServiceReportEntryRow[];
  const invoices = (invoicesData ?? []) as ClientServiceReportInvoiceRow[];
  const profitability = (profitabilityRes.data ?? []) as ServiceLedgerProfitabilityRow[];

  const letterheadDataUri = params.show_logo ? await pathToDataUri(supabase, settings?.letterhead_path) : null;

  // DIRECT_EXPENSES total is every logged expense regardless of
  // reimbursable status — get_client_service_period_summary only
  // returns the reimbursable subset, so this sums entries' own
  // per-entry expense_amount (already an all-expenses total) here
  // instead of adding a second SQL rollup for one derived number.
  const directExpenseByCurrency = new Map<string, number>();
  for (const e of entries) {
    directExpenseByCurrency.set(e.currency_code, (directExpenseByCurrency.get(e.currency_code) ?? 0) + Number(e.expense_amount));
  }

  const claimableByCurrency = new Map<string, number>();
  for (const r of summary) {
    claimableByCurrency.set(r.currency_code, Number(r.service_fee) + Number(r.billable_time_amount) + Number(r.reimbursable_expense_amount));
  }

  // AMOUNTS_RECEIVED: only sales_documents already fully SETTLED are
  // counted — a PARTIALLY_SETTLED document's actual received portion
  // lives in the receipts/settlement machinery, out of scope here, so
  // it is deliberately never estimated (spec's own "no financial number
  // without a source" rule).
  const receivedByCurrency = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === "SETTLED") receivedByCurrency.set(inv.currency_code, (receivedByCurrency.get(inv.currency_code) ?? 0) + Number(inv.total_amount));
  }

  const totalMinutes = entries.reduce((sum, e) => sum + Number(e.duration_minutes), 0);

  // Reimbursed cost isn't a column get_client_service_profitability
  // returns directly — it's derivable from data already fetched here:
  // (every expense) minus (the non-reimbursed portion) = the
  // reimbursed portion. No second SQL rollup needed for one derived
  // number, same reasoning as the DIRECT_EXPENSES total above.
  const reimbursedCostRows = profitability.map((r) => ({
    currency_code: r.currency_code,
    amount: (directExpenseByCurrency.get(r.currency_code) ?? 0) - Number(r.non_reimbursed_direct_cost),
    data_complete: r.data_complete,
  }));

  const fieldCells: Record<ReportField, (e: ClientServiceReportEntryRow) => string> = {
    DATE: (e) => formatJalali(e.service_date),
    CATEGORY: (e) => e.category_name,
    SERVICE_TITLE: (e) => e.title,
    DESCRIPTION: (e) => e.description ?? "—",
    PERFORMER: (e) => e.performer_name ?? "—",
    DURATION: (e) => durationLabel(e.duration_minutes),
    SERVICE_FEE: (e) => money(e.service_fee, e.currency_code),
    EXPENSE: (e) => money(e.expense_amount, e.currency_code),
    CLAIMABLE_AMOUNT: (e) => money(e.claimable_amount, e.currency_code),
    BILLING_STATUS: (e) => BILLING_STATUS_LABEL[e.billing_status as keyof typeof BILLING_STATUS_LABEL] ?? e.billing_status,
  };
  const selectedFields = params.selected_fields.filter((f): f is ReportField => f in fieldCells);
  const servicesColumns = selectedFields.map((f) => REPORT_FIELD_LABEL[f]);
  const servicesRows: TableRow[] = entries.map((e) => ({ cells: selectedFields.map((f) => fieldCells[f](e)) }));

  const contractTitles = Array.from(new Set(entries.map((e) => e.contract_title).filter((t): t is string => !!t)));
  const projectTitles = Array.from(new Set(entries.map((e) => e.project_title).filter((t): t is string => !!t)));

  const invoicesColumns = ["نوع", "شماره", "وضعیت", "تاریخ صدور", "مبلغ"];
  const invoicesRows: TableRow[] = invoices.map((inv) => ({
    cells: [
      SALES_DOCUMENT_TYPE_LABEL[inv.doc_type] ?? inv.doc_type,
      inv.display_number ? toFaDigits(inv.display_number) : "—",
      SALES_DOCUMENT_STATUS_LABEL[inv.status as keyof typeof SALES_DOCUMENT_STATUS_LABEL] ?? inv.status,
      inv.issue_date ? formatJalali(inv.issue_date) : "—",
      money(inv.total_amount, inv.currency_code),
    ],
  }));

  let documentsReferenceLines: string[] = [];
  if (params.selected_sections.includes("DOCUMENTS_REFERENCE") && entries.length > 0) {
    const { data: attachments } = await supabase
      .from("attachments")
      .select("file_name")
      .eq("entity_type", "SERVICE_ENTRY")
      .in("entity_id", entries.map((e) => e.service_entry_id));
    documentsReferenceLines = (attachments ?? []).map((a: { file_name: string }) => a.file_name);
  }

  const dataAsOf = new Date().toISOString();

  const buffer = await renderClientServiceReportPdf({
    title: params.title,
    companyName,
    periodLabel: `${formatJalali(params.period_start)} تا ${formatJalali(params.period_end)}`,
    generatedAtLabel: formatJalali(dataAsOf),
    detailLevelLabel: REPORT_DETAIL_LEVEL_LABEL[params.detail_level],
    introduction: params.introduction ?? null,
    finalNote: params.final_note ?? null,
    customNotes: params.custom_notes ?? null,
    showLogo: params.show_logo,
    showPageNumbers: params.show_page_numbers,
    letterheadDataUri,
    reportFamily: params.report_family,
    sectionOrder: params.selected_sections,
    servicesCountLabel: `${toFaDigits(entries.length)} خدمت انجام‌شده در این بازه`,
    servicesColumns,
    servicesRows,
    timeSpentTotalLabel: totalMinutes > 0 ? `مجموع زمان صرف‌شده: ${durationLabel(totalMinutes)}` : null,
    directExpenseTotals: currencyLinesFrom(Array.from(directExpenseByCurrency, ([currency_code, amount]) => ({ currency_code, amount }))),
    reimbursableExpenseTotals: currencyLinesFrom(summary.map((r) => ({ currency_code: r.currency_code, amount: Number(r.reimbursable_expense_amount) }))),
    serviceFeeTotals: currencyLinesFrom(summary.map((r) => ({ currency_code: r.currency_code, amount: Number(r.service_fee) }))),
    claimableTotals: currencyLinesFrom(Array.from(claimableByCurrency, ([currency_code, amount]) => ({ currency_code, amount }))),
    invoicedTotals: currencyLinesFrom(summary.map((r) => ({ currency_code: r.currency_code, amount: Number(r.invoiced_amount) }))),
    unbilledTotals: currencyLinesFrom(summary.map((r) => ({ currency_code: r.currency_code, amount: Number(r.unbilled_amount) }))),
    receivedTotals: currencyLinesFrom(Array.from(receivedByCurrency, ([currency_code, amount]) => ({ currency_code, amount }))),
    revenueTotals: profitabilityLinesFrom(profitability.map((r) => ({ currency_code: r.currency_code, amount: Number(r.revenue), data_complete: r.data_complete }))),
    internalTimeCostTotals: profitabilityLinesFrom(profitability.map((r) => ({ currency_code: r.currency_code, amount: Number(r.internal_time_cost), data_complete: r.data_complete }))),
    reimbursedCostTotals: profitabilityLinesFrom(reimbursedCostRows),
    unreimbursedCostTotals: profitabilityLinesFrom(profitability.map((r) => ({ currency_code: r.currency_code, amount: Number(r.non_reimbursed_direct_cost), data_complete: r.data_complete }))),
    contributionMarginTotals: profitabilityLinesFrom(profitability.map((r) => ({ currency_code: r.currency_code, amount: Number(r.contribution_margin), data_complete: r.data_complete }))),
    contractTitles,
    projectTitles,
    invoicesColumns,
    invoicesRows,
    documentsReferenceLines,
    periodSummaryNote: `این گزارش بازهٔ ${formatJalali(params.period_start)} تا ${formatJalali(params.period_end)} را پوشش می‌دهد و در تاریخ ${formatJalali(dataAsOf)} تهیه شده است.`,
  });

  const fileName = `گزارش-${companyName}-${formatJalali(params.period_start)}.pdf`;
  return { buffer, fileName, dataAsOf };
}

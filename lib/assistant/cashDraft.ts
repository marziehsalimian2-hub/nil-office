import { createHash } from "node:crypto";
import { formatJalali } from "@/lib/jalali";
import { formatExactAmount } from "@/lib/payroll/format";

/**
 * Pure rules for receipt / payment DRAFTS created by the Assistant (Slice 2). No Supabase, no "server-only" —
 * unit-tested in cashDraft.test.ts. The model supplies extracted text; every value is validated HERE before it can
 * reach a proposal (spec §49/§50: raw model output is never inserted). Nothing in this file verifies, posts or
 * allocates anything — see docs/ACCOUNTING_AI_SAFETY.md.
 */

export type CashKind = "RECEIPT" | "PAYMENT";

export const CASH_LABEL: Record<CashKind, { noun: string; party: string; table: "receipts" | "payments" }> = {
  RECEIPT: { noun: "دریافت", party: "پرداخت‌کننده", table: "receipts" },
  PAYMENT: { noun: "پرداخت/هزینه", party: "دریافت‌کننده", table: "payments" },
};

// ---------------------------------------------------------------- free text
/** Free text copied off a document is DATA: control characters stripped, whitespace collapsed, length capped. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  const t = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, max);
}

// ---------------------------------------------------------------- amount
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizeDigits(raw: string): string {
  return raw.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

export type ParsedAmount = { ok: true; value: string } | { ok: false; error: string };

/**
 * Amount text -> canonical exact decimal STRING (never a float). Thousand separators (`,` `٬` `،`) and spaces are
 * accepted; anything ambiguous is REFUSED so the model must ask the user instead of guessing:
 * letters/words ("صد میلیون"), several dots ("1.500.000"), a single dot followed by exactly 3 digits ("1.500" — decimal
 * or thousands?), signs, more than 16 integer digits, or a zero amount.
 */
export function parseAmountText(raw: string): ParsedAmount {
  const cleaned = normalizeDigits(String(raw ?? "")).replace(/[,٬،\s]/g, "");
  if (cleaned === "") return { ok: false, error: "مبلغ مشخص نیست." };
  if (!/^[0-9.]+$/.test(cleaned)) return { ok: false, error: "مبلغ باید فقط عدد باشد (کلمه، علامت یا واحد داخل مبلغ ننویس) — از کاربر عدد دقیق را بپرس." };
  const dots = (cleaned.match(/\./g) ?? []).length;
  if (dots > 1) return { ok: false, error: "قالب مبلغ مبهم است (چند نقطه). عدد دقیق را از کاربر بپرس." };
  let [intPart, frac = ""] = cleaned.split(".");
  if (cleaned.includes(".") && (intPart === "" || frac === "")) return { ok: false, error: "قالب مبلغ نامعتبر است." };
  if (frac.length === 3) return { ok: false, error: "مبلغ مبهم است (آیا «.» جداکنندهٔ هزارگان است یا اعشار؟). عدد دقیق را از کاربر بپرس." };
  if (frac.length > 4) return { ok: false, error: "حداکثر ۴ رقم اعشار پذیرفته می‌شود." };
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart.length > 16) return { ok: false, error: "مبلغ بیش از حد بزرگ است؛ احتمالاً اشتباه خوانده شده — از کاربر بپرس." };
  frac = frac.replace(/0+$/, "");
  if (/^0*$/.test(intPart) && frac === "") return { ok: false, error: "مبلغ باید بزرگ‌تر از صفر باشد." };
  return { ok: true, value: frac ? `${intPart}.${frac}` : intPart };
}

// ---------------------------------------------------------------- date
export const STALE_DAYS = 90;

export type DateCheck = { ok: true; warning?: string } | { ok: false; error: string };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** A cash document cannot be dated in the future (more than one day, for time-zone slack); a very old one is allowed with a warning. */
export function checkDraftDate(iso: string, todayIso: string): DateCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return { ok: false, error: "تاریخ نامعتبر است." };
  const diff = dayDiff(iso, todayIso);
  if (diff > 1) return { ok: false, error: "تاریخ سند در آینده است؛ احتمالاً اشتباه خوانده شده — تاریخ دقیق را از کاربر بپرس." };
  if (diff < -STALE_DAYS) return { ok: true, warning: `تاریخ سند بیش از ${STALE_DAYS} روز قبل است — صحت آن را بررسی کنید.` };
  return { ok: true };
}

// ---------------------------------------------------------------- fiscal year
export type FiscalYearLite = { id: string; start_date: string; end_date: string; status: string };

/** The ONE open fiscal year containing the date; none or several -> null (the accountant chooses; never guessed). */
export function pickFiscalYear(years: FiscalYearLite[], dateIso: string): string | null {
  const hits = years.filter((y) => y.status === "OPEN" && y.start_date <= dateIso && dateIso <= y.end_date);
  return hits.length === 1 ? hits[0].id : null;
}

// ---------------------------------------------------------------- duplicates
export type DuplicateRow = {
  kind: CashKind; id: string; status: string; display_number: string | null; date: string;
  amount: string; currency: string; counterparty: string | null;
  reason: "SAME_FILE" | "SAME_REFERENCE" | "SAME_DAY_AMOUNT" | "NEAR_DATE_SAME_COMPANY";
};
export type DuplicateReport = { hard: DuplicateRow[]; soft: DuplicateRow[] };

const REASON_FA: Record<DuplicateRow["reason"], string> = {
  SAME_FILE: "همان فایل مدرک قبلاً ثبت شده",
  SAME_REFERENCE: "همان شمارهٔ پیگیری/مرجع با همین مبلغ و ارز",
  SAME_DAY_AMOUNT: "همان روز، مبلغ و ارز",
  NEAR_DATE_SAME_COMPANY: "مبلغ و ارز یکسان برای همین شرکت در چند روز نزدیک",
};

export function describeDuplicate(r: DuplicateRow): string {
  const label = CASH_LABEL[r.kind].noun;
  const state = r.status === "POSTED" ? "قطعی‌شده" : "پیش‌نویس";
  return `${label} ${r.display_number ?? "(بدون شماره)"} — ${state}، ${formatJalali(r.date)}، ${formatExactAmount(r.amount, r.currency)}${r.counterparty ? `، ${r.counterparty}` : ""} (${REASON_FA[r.reason]})`;
}

export type DuplicateDecision = { block: true; message: string } | { block: false; warnings: string[] };

/**
 * HARD duplicates stop the proposal unless the user explicitly said it is not a duplicate; in that case (and for SOFT
 * ones) the warning is carried INTO the preview so the human sees it before tapping confirm.
 */
export function decideDuplicates(report: DuplicateReport, confirmedNotDuplicate: boolean): DuplicateDecision {
  const hard = report.hard.map((r) => `⚠️ احتمال تکراری قطعی: ${describeDuplicate(r)}`);
  const soft = report.soft.map((r) => `⚠️ شباهت: ${describeDuplicate(r)}`);
  if (hard.length > 0 && !confirmedNotDuplicate) {
    return {
      block: true,
      message: `این سند به‌احتمال زیاد تکراری است و پیش‌نویس ساخته نشد:\n${hard.join("\n")}\nاین مورد را به کاربر نشان بده و بپرس آیا واقعاً سند جدا و غیرتکراری است؛ فقط اگر کاربر صراحتاً گفت «تکراری نیست»، دوباره با confirmed_not_duplicate=true پیشنهاد بده.`,
    };
  }
  return { block: false, warnings: [...hard.map((w) => `${w} — کاربر اعلام کرده تکراری نیست`), ...soft] };
}

// ---------------------------------------------------------------- evidence
export const sha256Hex = (bytes: Uint8Array | Buffer): string => createHash("sha256").update(bytes).digest("hex");

export const EVIDENCE_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

// ---------------------------------------------------------------- preview
export type PreviewInput = {
  kind: CashKind;
  amount: string;
  currency: string;
  dateIso: string;
  counterparty: string | null;
  companyName: string | null;
  contractLabel: string | null;
  bankAccountLabel: string | null;
  method: string | null;
  reference: string | null;
  description: string | null;
  source: "IMAGE" | "PDF" | "TEXT";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  warnings: string[];
  openInvoiceHints: string[];
  fiscalYearFound: boolean;
};

const SOURCE_FA: Record<PreviewInput["source"], string> = {
  IMAGE: "تصویر (به‌عنوان مدرک بایگانی می‌شود)",
  PDF: "فایل PDF (به‌عنوان مدرک بایگانی می‌شود)",
  TEXT: "پیام متنی/صوتی (بدون فایل مدرک)",
};

/** What the accountant still has to complete before verify/post — the assistant never decides bookkeeping accounts. */
export function missingAccountingFields(p: { bankAccountLabel: string | null; fiscalYearFound: boolean }): string[] {
  const out: string[] = [];
  if (!p.bankAccountLabel) out.push("حساب بانکی/صندوق");
  out.push("حساب طرف مقابل");
  if (!p.fiscalYearFound) out.push("سال مالی");
  return out;
}

export function buildCashPreview(p: PreviewInput): string {
  const L = CASH_LABEL[p.kind];
  const lines = [
    `پیش‌نویس ${L.noun} — فقط پیش‌نویس ذخیره می‌شود؛ تأیید، ثبت قطعی و تسویهٔ فاکتور فقط توسط حسابدار در NIL Office انجام می‌شود.`,
    `مبلغ: ${formatExactAmount(p.amount, p.currency)} (بدون تبدیل واحد)`,
    `تاریخ: ${formatJalali(p.dateIso)}`,
    `${L.party}: ${p.counterparty ?? "—"}`,
    p.companyName ? `شرکت: ${p.companyName}` : null,
    p.contractLabel ? `قرارداد: ${p.contractLabel}` : null,
    `حساب بانکی: ${p.bankAccountLabel ?? "تعیین نشده — حسابدار انتخاب می‌کند"}`,
    p.method ? `روش: ${p.method}` : null,
    p.reference ? `شمارهٔ پیگیری/مرجع: ${p.reference}` : null,
    p.description ? `شرح: ${p.description}` : null,
    `منبع: ${SOURCE_FA[p.source]}`,
    `اطمینان استخراج: ${p.confidence === "HIGH" ? "بالا" : p.confidence === "MEDIUM" ? "متوسط" : "پایین ⚠️ — همهٔ مقادیر را با دقت بررسی کنید"}`,
    ...p.warnings,
    ...(p.openInvoiceHints.length ? ["فاکتورهای بازِ مرتبط (فقط اطلاع؛ تخصیص/تسویه توسط حسابدار):", ...p.openInvoiceHints.map((h) => `• ${h}`)] : []),
    `برای ثبت نهایی حسابدار باید تکمیل کند: ${missingAccountingFields(p).join("، ")}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

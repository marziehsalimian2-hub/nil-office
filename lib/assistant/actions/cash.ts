import "server-only";
import { z } from "zod";
import { CURRENCY } from "@/lib/enums";
import { resolveDatePhrase, todayIso } from "@/lib/assistant/dates";
import {
  CASH_LABEL, EVIDENCE_EXT_BY_MIME, buildCashPreview, checkDraftDate, cleanText, decideDuplicates, parseAmountText, pickFiscalYear, sha256Hex,
  type CashKind, type DuplicateReport, type FiscalYearLite,
} from "@/lib/assistant/cashDraft";
import { formatExactAmount } from "@/lib/payroll/format";
import type { CashDraftPayload } from "@/app/actions/accounting";
import { requireResolved } from "@/lib/assistant/entityLedger";
import { canCreateAccounting, hasAccountingAccess } from "./access";
import type { ActionContext, ActionDefinition, WriteProposal } from "./types";

/**
 * Receipt / payment DRAFTS from a photo, PDF, voice or text (Internal Assistant v1.0, Slice 2; spec §11-14).
 *
 * Boundaries (docs/ACCOUNTING_AI_SAFETY.md — enforced by registry.test.ts too):
 *   - the ONLY write is a DRAFT row via createCashDraftCore; nothing here verifies, posts or allocates, and no
 *     journal is touched. The evidence image is evidence, never settlement;
 *   - every model-supplied value is validated server-side (cashDraft.ts) before it can reach a proposal;
 *   - nothing critical is guessed: amount, currency, date and a payer/payee are required, the bank account is
 *     asked for (LIST_BANK_ACCOUNTS) and left empty rather than invented, the bookkeeping counterpart account is
 *     never set;
 *   - duplicate control (same file hash / same reference + amount + currency) runs BEFORE the proposal and again
 *     at execute time;
 *   - the file bytes and its source come from the turn's real attachment (ctx.turnAttachment), never from the model.
 */

const cashDraftInput = z.object({
  amount_text: z.string().trim().min(1, "مبلغ الزامی است."),
  currency: z.enum(CURRENCY),
  date_phrase: z.string().trim().min(1, "تاریخ سند الزامی است."),
  counterparty_name: z.string().trim().optional(),
  company_id: z.string().uuid().optional(),
  contract_id: z.string().uuid().optional(),
  bank_account_id: z.string().uuid().optional(),
  method: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  description: z.string().trim().optional(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  confirmed_not_duplicate: z.boolean().optional(),
});
type CashDraftInput = z.infer<typeof cashDraftInput>;

const COMMON_DESCRIPTION =
  "مبلغ را دقیقاً با ارقام همان‌طور که در سند/گفتار آمده در amount_text بنویس (بدون کلمه و واحد؛ مثلاً 100000000) و واحد را جدا در currency — هرگز واحد را تبدیل نکن (تومان را ریال نکن) و اگر واحد پول مشخص نیست از کاربر بپرس. date_phrase تاریخ روی سند (شمسی مثل ۱۴۰۵/۰۷/۰۱، یا «امروز»/«دیروز») است. company_id را فقط از SEARCH_COMPANY و bank_account_id را فقط از LIST_BANK_ACCOUNTS بگیر؛ اگر حساب بانکی یا شرکت مشخص نیست از کاربر بپرس یا خالی بگذار — حدس نزن. فیلدی که در تصویر ناخوانا است را ننویس و از کاربر بپرس. confidence میزان اطمینان تو از خواندن کل سند است (اگر چیزی را حدس زده‌ای LOW). reference شمارهٔ پیگیری/مرجع روی سند است. فقط پیش‌نویس ساخته می‌شود: هرگز نگو سند تأیید، ثبت قطعی یا فاکتور تسویه شد — تأیید/ثبت/تسویه فقط کار حسابدار در NIL Office است. اگر سیستم احتمال تکراری‌بودن داد، آن را به کاربر نشان بده و فقط با اعلام صریح او confirmed_not_duplicate=true بفرست. تصویر رسید فقط «مدرک» است، نه تأیید پرداخت.";

async function buildCashDraftProposal(kind: CashKind, input: CashDraftInput, ctx: ActionContext): Promise<WriteProposal> {
  const L = CASH_LABEL[kind];

  // Financial: the company / contract must have been resolved with the STRICT bar (or picked by the user) — never a guessed id.
  requireResolved(ctx.userId, "company", input.company_id, { strict: true });
  requireResolved(ctx.userId, "contract", input.contract_id, { strict: true });

  const amount = parseAmountText(input.amount_text);
  if (!amount.ok) throw new Error(amount.error);

  const resolved = resolveDatePhrase(input.date_phrase);
  if ("error" in resolved) throw new Error(resolved.error);
  const dateCheck = checkDraftDate(resolved.iso, todayIso());
  if (!dateCheck.ok) throw new Error(dateCheck.error);

  const counterpartyInput = cleanText(input.counterparty_name, 200);
  if (!input.company_id && !counterpartyInput) {
    throw new Error(`${L.party} (شرکت یا نام) باید مشخص باشد — از کاربر بپرس.`);
  }

  let companyName: string | null = null;
  if (input.company_id) {
    const { data: company } = await ctx.supabase.from("companies").select("id, legal_name").eq("id", input.company_id).maybeSingle();
    if (!company) throw new Error("شرکت انتخاب‌شده پیدا نشد — با SEARCH_COMPANY دوباره پیدا کن.");
    companyName = company.legal_name;
  }

  let contractLabel: string | null = null;
  if (input.contract_id) {
    if (!input.company_id) throw new Error("برای انتخاب قرارداد، شرکت هم باید مشخص باشد.");
    const { data: contract } = await ctx.supabase
      .from("contracts").select("id, title, display_number, counterparty_company_id").eq("id", input.contract_id).maybeSingle();
    if (!contract) throw new Error("قرارداد انتخاب‌شده پیدا نشد.");
    if (contract.counterparty_company_id !== input.company_id) throw new Error("این قرارداد متعلق به شرکت انتخاب‌شده نیست.");
    contractLabel = contract.display_number ?? contract.title;
  }

  let bankAccountLabel: string | null = null;
  if (input.bank_account_id) {
    const { data: bank } = await ctx.supabase
      .from("bank_accounts").select("id, account_title, currency_code, is_active").eq("id", input.bank_account_id).maybeSingle();
    if (!bank || !bank.is_active) throw new Error("حساب بانکی انتخاب‌شده پیدا نشد یا غیرفعال است — با LIST_BANK_ACCOUNTS دوباره انتخاب کن.");
    if (bank.currency_code !== input.currency) throw new Error(`ارز این حساب بانکی (${bank.currency_code}) با ارز سند (${input.currency}) یکی نیست — از کاربر بپرس.`);
    bankAccountLabel = bank.account_title;
  }

  const { data: years } = await ctx.supabase.from("fiscal_years").select("id, start_date, end_date, status");
  const fiscalYearId = pickFiscalYear((years ?? []) as FiscalYearLite[], resolved.iso);

  // Evidence: the real bytes of THIS turn's attachment — never anything the model wrote.
  let source: "IMAGE" | "PDF" | "TEXT" = "TEXT";
  let evidenceBase64: string | null = null;
  let evidenceMime: string | null = null;
  let evidenceSha: string | null = null;
  if (ctx.turnAttachment) {
    if (!EVIDENCE_EXT_BY_MIME[ctx.turnAttachment.mediaType]) throw new Error("نوع فایل پیوست پشتیبانی نمی‌شود.");
    evidenceBase64 = ctx.turnAttachment.data;
    evidenceMime = ctx.turnAttachment.mediaType;
    evidenceSha = sha256Hex(Buffer.from(evidenceBase64, "base64"));
    source = evidenceMime === "application/pdf" ? "PDF" : "IMAGE";
  }

  const reference = cleanText(input.reference, 100);
  const { data: dup, error: dupErr } = await ctx.supabase.rpc("assistant_cash_duplicates", {
    p_profile_id: ctx.userId, p_kind: kind, p_amount: amount.value, p_currency: input.currency,
    p_reference: reference, p_date: resolved.iso, p_company: input.company_id ?? null, p_sha256: evidenceSha,
  });
  if (dupErr || !dup) {
    console.error("[assistant] assistant_cash_duplicates failed", dupErr?.message);
    throw new Error("بررسی تکراری‌بودن سند ناموفق بود؛ چیزی پیشنهاد نشد. دوباره تلاش کن.");
  }
  const decision = decideDuplicates(dup as DuplicateReport, input.confirmed_not_duplicate === true);
  if (decision.block) throw new Error(decision.message);

  // Matching hints for a receipt (spec §12): information only — no allocation, no settlement.
  const openInvoiceHints: string[] = [];
  if (kind === "RECEIPT" && input.company_id) {
    const { data: invoices } = await ctx.supabase
      .from("sales_documents")
      .select("display_number, total_amount, currency_code")
      .eq("company_id", input.company_id).eq("type", "INVOICE").eq("currency_code", input.currency)
      .in("status", ["ISSUED", "PARTIALLY_SETTLED", "OVERDUE"])
      .order("created_at", { ascending: false }).limit(20);
    const rows = (invoices ?? []) as { display_number: string | null; total_amount: number | string; currency_code: string }[];
    const exact = rows.filter((r) => Number(r.total_amount) === Number(amount.value));
    for (const r of (exact.length ? exact : rows).slice(0, 3)) {
      openInvoiceHints.push(`فاکتور ${r.display_number ?? "—"}: ${formatExactAmount(String(r.total_amount), r.currency_code)}${exact.includes(r) ? " (مبلغ برابر با این رسید)" : ""}`);
    }
  }

  const counterparty = counterpartyInput ?? companyName;
  const method = cleanText(input.method, 40);
  const description = cleanText(input.description, 500);

  const warnings = [...(dateCheck.warning ? [`⚠️ ${dateCheck.warning}`] : []), ...decision.warnings];
  const payload: CashDraftPayload = {
    kind,
    amount: amount.value,
    currency: input.currency,
    date: resolved.iso,
    counterparty,
    company_id: input.company_id ?? null,
    contract_id: input.contract_id ?? null,
    bank_account_id: input.bank_account_id ?? null,
    fiscal_year_id: fiscalYearId,
    method,
    reference,
    description,
    confirmed_not_duplicate: input.confirmed_not_duplicate === true,
    evidence_base64: evidenceBase64,
    evidence_mime: evidenceMime,
    evidence_sha256: evidenceSha,
  };

  const previewText = buildCashPreview({
    kind, amount: amount.value, currency: input.currency, dateIso: resolved.iso, counterparty, companyName, contractLabel,
    bankAccountLabel, method, reference, description, source, confidence: input.confidence, warnings, openInvoiceHints,
    fiscalYearFound: fiscalYearId !== null,
  });
  return { payload: payload as unknown as Record<string, unknown>, previewText };
}

export const createReceiptDraft: ActionDefinition<CashDraftInput> = {
  name: "CREATE_RECEIPT_DRAFT",
  description:
    `پیشنهاد ساخت «پیش‌نویس دریافت» (رسید واریز مشتری/پول دریافتی) از عکس رسید بانکی، PDF، پیام صوتی یا متن — نه ثبت قطعی؛ فقط پیش‌نمایش برای تأیید کاربر. ${COMMON_DESCRIPTION} counterparty_name نام پرداخت‌کننده است.`,
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  requiredAccess: canCreateAccounting,
  inputSchema: cashDraftInput,
  handler: (input, ctx) => buildCashDraftProposal("RECEIPT", input, ctx),
};

export const createPaymentDraft: ActionDefinition<CashDraftInput> = {
  name: "CREATE_PAYMENT_DRAFT",
  description:
    `پیشنهاد ساخت «پیش‌نویس پرداخت/هزینه» (پول پرداخت‌شده به تأمین‌کننده یا هزینه؛ از فاکتور تأمین‌کننده، رسید هزینه، عکس رسید بانکی، PDF، ویس یا متن) — نه ثبت قطعی؛ فقط پیش‌نمایش برای تأیید کاربر. ${COMMON_DESCRIPTION} counterparty_name نام دریافت‌کننده/تأمین‌کننده است.`,
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  requiredAccess: canCreateAccounting,
  inputSchema: cashDraftInput,
  handler: (input, ctx) => buildCashDraftProposal("PAYMENT", input, ctx),
};

/**
 * Lists the active bank / cash accounts so the model can pick one — id, title, bank name, currency and kind only
 * (never account numbers or IBANs). The proposal handler re-checks the chosen id (active + same currency).
 */
export const listBankAccounts: ActionDefinition<{ currency?: (typeof CURRENCY)[number] }> = {
  name: "LIST_BANK_ACCOUNTS",
  description:
    "فهرست حساب‌های بانکی/صندوق فعال شرکت (شناسه، عنوان، نام بانک، ارز و نوع — بدون شماره حساب) برای انتخاب bank_account_id هنگام ساخت پیش‌نویس دریافت/پرداخت. اگر کاربر حساب را مشخص نکرد یا چند حساب هم‌ارز بود، از او بپرس — حدس نزن. اختیاری: currency برای فیلتر.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  requiredAccess: hasAccountingAccess,
  inputSchema: z.object({ currency: z.enum(CURRENCY).optional() }),
  handler: async (input, ctx) => {
    let q = ctx.supabase.from("bank_accounts").select("id, account_title, bank_name, currency_code, kind").eq("is_active", true).order("account_title").limit(50);
    if (input.currency) q = q.eq("currency_code", input.currency);
    const { data } = await q;
    return { data: data ?? [] };
  },
};

export const cashActions: ActionDefinition<any>[] = [createReceiptDraft, createPaymentDraft, listBankAccounts];

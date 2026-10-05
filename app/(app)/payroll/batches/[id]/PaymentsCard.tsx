"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPayrollPaymentDrafts, discardPayrollPaymentDrafts } from "@/app/actions/payroll-payments";
import { FormError } from "@/components/form";
import { MoneyInput } from "@/components/MoneyInput";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { POSTING_STATUS_LABEL, PAYROLL_PAYMENT_STATE_LABEL, PAYROLL_PAYMENT_STATE_TONE, type PostingStatus } from "@/lib/enums";
import { formatExactAmount } from "@/lib/payroll/format";
import { formatJalali } from "@/lib/jalali";
import { bankMatchesBatch, hasAvailable, type BankAccountOption, type PaymentSummary } from "@/lib/payroll/review";

const trimZeros = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

/**
 * Salary payments through Financial Receipts & Payments. Paid/outstanding/state are DERIVED by the DB from real POSTED payments —
 * nothing here can mark anything paid. Drafts are verified and posted in Accounting (the normal payments flow).
 */
export function PaymentsCard({
  batchId, currency, summary, banks, ledgerCurrencies, canCreate, canOpenAccounting, defaultDateISO,
}: {
  batchId: string; currency: string; summary: PaymentSummary; banks: BankAccountOption[]; ledgerCurrencies: string[];
  canCreate: boolean; canOpenAccounting: boolean; defaultDateISO: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const [bank, setBank] = useState("");
  const [date, setDate] = useState(defaultDateISO);
  const [method, setMethod] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of summary.rows) m[r.result_id] = trimZeros(r.available);
    return m;
  });
  const [picked, setPicked] = useState<Set<string>>(() => new Set(summary.rows.filter((r) => hasAvailable(r.available)).map((r) => r.result_id)));

  const eligibleBanks = useMemo(() => banks.filter((b) => bankMatchesBatch(b.currency_code, currency, ledgerCurrencies)), [banks, currency, ledgerCurrencies]);
  const hasDrafts = summary.rows.some((r) => r.payments.some((p) => p.status === "DRAFT"));
  const journalNotPosted = summary.accounting_journal_status !== "POSTED";

  function create() {
    const items = summary.rows
      .filter((r) => picked.has(r.result_id) && amounts[r.result_id])
      .map((r) => ({ result_id: r.result_id, amount: amounts[r.result_id] }));
    const fd = new FormData();
    fd.set("batch_id", batchId);
    fd.set("bank_account_id", bank);
    fd.set("payment_date", date);
    if (method.trim()) fd.set("method", method.trim());
    fd.set("items", JSON.stringify(items));
    start(async () => {
      const r = await createPayrollPaymentDrafts(null, fd);
      if (r?.error) setError(r.error);
      else { setError(undefined); router.refresh(); }
    });
  }

  function discard() {
    if (!window.confirm("همهٔ پیش‌نویس‌های پرداخت این دسته حذف شوند؟ پرداخت‌های قطعی حذف نمی‌شوند.")) return;
    const fd = new FormData();
    fd.set("batch_id", batchId);
    start(async () => {
      const r = await discardPayrollPaymentDrafts(null, fd);
      if (r?.error) setError(r.error);
      else { setError(undefined); router.refresh(); }
    });
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-ink">پرداخت حقوق</h2>
        <span className={`badge ${PAYROLL_PAYMENT_STATE_TONE[summary.payment_state]}`}>{PAYROLL_PAYMENT_STATE_LABEL[summary.payment_state]}</span>
        <span className="text-xs text-ink-muted">
          پرداخت‌شده {formatExactAmount(summary.totals.paid)} از {formatExactAmount(summary.totals.net)} — مانده {formatExactAmount(summary.totals.outstanding)}
        </span>
      </div>
      <FormError message={error} />
      {journalNotPosted && (
        <p className="rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-3 py-2 text-xs text-ink">
          سند حسابداری حقوق هنوز قطعی نشده است؛ پرداخت ممکن است قبل از ثبت تعهد حقوق در دفتر، ثبت شود (فقط هشدار).
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="table-head">
              {canCreate && <th className="px-2 py-2" />}
              <th className="px-2 py-2 text-start">فرد</th>
              <th className="px-2 py-2 text-start">خالص</th>
              <th className="px-2 py-2 text-start">پرداخت‌شده</th>
              <th className="px-2 py-2 text-start">پیش‌نویس</th>
              <th className="px-2 py-2 text-start">مانده</th>
              {canCreate && <th className="px-2 py-2 text-start">مبلغ پرداخت جدید</th>}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => {
              const can = hasAvailable(r.available);
              return (
                <tr key={r.result_id} className="table-row align-top">
                  {canCreate && (
                    <td className="px-2 py-2">
                      <input type="checkbox" disabled={!can} checked={picked.has(r.result_id) && can}
                        onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.result_id); else n.delete(r.result_id); return n; })} />
                    </td>
                  )}
                  <td className="px-2 py-2">
                    <div className="font-medium text-ink">{r.personnel_name}</div>
                    <div className="tnum text-xs text-ink-muted">{r.personnel_number}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs">
                      {r.overpaid && <span className="badge status-cancelled">پرداخت بیش از خالص</span>}
                      {r.amount_changed && <span className="badge status-waiting">مبلغ پرداخت بعد از ساخت تغییر کرده</span>}
                      {r.payments.map((p) => (
                        <span key={p.payment_id} className="badge status-draft">
                          {p.display_number ?? "پیش‌نویس"} · {POSTING_STATUS_LABEL[p.status as PostingStatus] ?? p.status}
                          {p.status === "POSTED" && p.journal_status !== "POSTED" ? " (سند برگشت خورده)" : ""} · {formatJalali(p.payment_date)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="tnum px-2 py-2">{formatExactAmount(r.net)}</td>
                  <td className="tnum px-2 py-2">{formatExactAmount(r.paid)}</td>
                  <td className="tnum px-2 py-2 text-ink-muted">{formatExactAmount(r.drafted)}</td>
                  <td className="tnum px-2 py-2 font-medium">{formatExactAmount(r.outstanding)}</td>
                  {canCreate && (
                    <td className="px-2 py-2">
                      {can ? <MoneyInput value={amounts[r.result_id] ?? ""} className="w-36"
                        onChange={(raw) => setAmounts((a) => ({ ...a, [r.result_id]: raw }))} /> : <span className="text-ink-muted">—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canCreate ? (
        <div className="space-y-3 rounded-lg border border-paper-line p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="field-label">حساب بانکی/صندوق (هم‌واحد با دسته)</span>
              <select className="input" value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">— انتخاب —</option>
                {eligibleBanks.map((b) => (<option key={b.id} value={b.id}>{b.account_title}{b.bank_name ? ` — ${b.bank_name}` : ""}</option>))}
              </select></label>
            <label className="block"><span className="field-label">تاریخ پرداخت</span>
              <JalaliDateInput name="payment_date" defaultISO={defaultDateISO} onChange={setDate} /></label>
            <label className="block"><span className="field-label">روش (اختیاری)</span>
              <input className="input" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="انتقال بانکی" /></label>
          </div>
          {eligibleBanks.length === 0 && <p className="text-xs text-status-cancelled">هیچ حساب بانکی/صندوق فعال و متصل به سرفصل با این واحد پول وجود ندارد؛ در حسابداری تعریف کنید.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy || !bank || !date || picked.size === 0} onClick={create}>
              ساخت پیش‌نویس پرداخت
            </button>
            {hasDrafts && <button type="button" className="btn-quiet" disabled={busy} onClick={discard}>حذف پیش‌نویس‌های پرداخت</button>}
          </div>
          <p className="text-xs text-ink-muted">
            برای پرداخت ناقص، مبلغ را کمتر از مانده وارد کنید. پیش‌نویس‌ها در ماژول دریافت و پرداخت ساخته می‌شوند و تأیید و ثبت قطعی آن‌ها در حسابداری انجام می‌شود؛ وضعیت «پرداخت‌شده» فقط از پرداخت‌های قطعی محاسبه می‌شود.
            گیرندهٔ هر پرداخت نام کامل کارمند و مبلغ آن برای کاربران حسابداری قابل مشاهده است.
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">ساخت پیش‌نویس پرداخت هم دسترسی «تأیید» در حقوق و هم دسترسی «ثبت» در حسابداری می‌خواهد.</p>
      )}
      {canOpenAccounting && <Link href="/accounting/payments" className="text-sm text-seal hover:underline">رفتن به پرداخت‌ها در حسابداری (تأیید و ثبت قطعی)</Link>}
    </div>
  );
}

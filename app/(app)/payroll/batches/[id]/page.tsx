import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess, accountingAccess } from "@/lib/payroll/access";
import { PageHeader, StatCard, Card } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import {
  PAYROLL_BATCH_STATUS_LABEL, PAYROLL_BATCH_STATUS_TONE, PAYROLL_STALE_REASON_LABEL, PAYROLL_ROUNDING_MODE_LABEL,
  PAYROLL_PAYMENT_STATE_LABEL, PAYROLL_PAYMENT_STATE_TONE,
  CURRENCY_LABEL, type Currency, type PayrollBatchStatus, type PayrollRoundingMode,
} from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { jalaliMonthLabel } from "@/lib/payroll/period";
import { formatExactAmount } from "@/lib/payroll/format";
import type { PayrollReview, WorkGridRow, AccountingReadiness, PaymentSummary, BankAccountOption } from "@/lib/payroll/review";
import type { BatchPayslipRow } from "@/lib/payroll/payslip";
import { ResultsTable } from "./ResultsTable";
import { WarningsList } from "./WarningsList";
import { EligibilityPanel, type PersonOption } from "./EligibilityPanel";
import { BatchActions } from "./BatchActions";
import { BatchSettingsForm } from "./BatchSettingsForm";
import { AccountingCard } from "./AccountingCard";
import { PaymentsCard } from "./PaymentsCard";
import { PayslipsCard } from "./PayslipsCard";

export const dynamic = "force-dynamic";

export default async function PayrollBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const access = payrollAccess(profile);
  const acc = accountingAccess(profile);

  const { data: review, error } = await supabase.rpc("payroll_review_data", { p_batch_id: id });
  if (error || !review) notFound();
  const r = review as PayrollReview;
  const b = r.batch;
  const status = b.status as PayrollBatchStatus;

  const showAccounting = b.status === "APPROVED" || b.accounting_journal_entry_id !== null;
  const [{ data: grid }, { data: sets }, { data: people }, { data: readiness }, { data: actors }, { data: paySummary }, { data: banks }, { data: slips }] = await Promise.all([
    supabase.rpc("payroll_work_grid", { p_period_id: r.period.id, p_batch_id: id }),
    supabase.from("legal_rule_sets").select("jurisdiction"),
    // HR-access users can list personnel (to offer an out-of-period INCLUDE); payroll-only users simply get none.
    supabase.from("personnel").select("id, first_name, last_name, personnel_number").order("personnel_number"),
    showAccounting ? supabase.rpc("payroll_accounting_readiness", { p_batch_id: id }) : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name").in("id", [b.approved_by, b.reviewed_by, b.submitted_by].filter((x): x is string => !!x)),
    b.status === "APPROVED" ? supabase.rpc("payroll_payment_summary", { p_batch_id: id }) : Promise.resolve({ data: null }),
    b.status === "APPROVED" ? supabase.rpc("payroll_bank_accounts") : Promise.resolve({ data: null }),
    b.status === "APPROVED" ? supabase.rpc("payroll_payslips_for_batch", { p_batch_id: id }) : Promise.resolve({ data: null }),
  ]);
  const payslipRows = (slips ?? null) as BatchPayslipRow[] | null;
  const payments = (paySummary ?? null) as PaymentSummary | null;
  const actorName = new Map(((actors ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]));
  const gridRows = (grid ?? []) as WorkGridRow[];
  const jurisdictions = [...new Set(((sets ?? []) as { jurisdiction: string }[]).map((s) => s.jurisdiction))].sort();

  const names: Record<string, string> = {};
  for (const g of gridRows) names[g.personnel_id] = g.name;
  for (const x of r.results) names[x.personnel_id] = x.personnel_name;
  const memberIds = new Set(r.results.map((x) => x.personnel_id));
  const decided = new Set(r.overrides.map((o) => o.personnel_id));
  const candMap = new Map<string, PersonOption>();
  for (const g of gridRows) if (!g.included && !memberIds.has(g.personnel_id) && !decided.has(g.personnel_id) && (g.currency === null || g.currency === b.currency))
    candMap.set(g.personnel_id, { personnel_id: g.personnel_id, label: `${g.name} (${g.personnel_number})` });
  for (const p of (people ?? []) as { id: string; first_name: string; last_name: string; personnel_number: string }[])
    if (!memberIds.has(p.id) && !decided.has(p.id) && !candMap.has(p.id))
      candMap.set(p.id, { personnel_id: p.id, label: `${p.first_name} ${p.last_name} (${p.personnel_number})` });

  const stale = r.stale.length > 0;
  const hasCalc = b.calculation_version > 0 && status !== "DRAFT";
  const cur = b.currency as Currency;
  const editable = status === "DRAFT" || status === "CALCULATED";
  const unit = CURRENCY_LABEL[cur] ?? cur;

  return (
    <div>
      <PageHeader
        title={`دستهٔ حقوقی ${b.batch_number}`}
        subtitle={`${jalaliMonthLabel(r.period.jalali_year, r.period.jalali_month)} — ${unit} — ${formatJalali(r.period.period_start)} تا ${formatJalali(r.period.period_end)}`}
        action={<Link href={`/payroll/periods/${r.period.id}`} className="btn-quiet">بازگشت به دوره</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className={`badge ${PAYROLL_BATCH_STATUS_TONE[status]}`}>{PAYROLL_BATCH_STATUS_LABEL[status]}</span>
        {b.calculation_version > 0 && <span className="text-ink-muted">نسخهٔ محاسبه: <span className="tnum text-ink">{toFaDigits(b.calculation_version)}</span> — {formatJalali(b.calculated_at)}</span>}
        <span className="text-ink-muted">گرد کردن: {toFaDigits(b.rounding_scale)} رقم اعشار، {PAYROLL_ROUNDING_MODE_LABEL[b.rounding_mode as PayrollRoundingMode]}</span>
        <span className="text-ink-muted">حوزهٔ قانونی: {b.jurisdiction ?? "بدون قاعدهٔ قانونی"}</span>
        {b.reviewed_at && <span className="badge status-final">بررسی‌شده {formatJalali(b.reviewed_at)}{b.reviewed_by ? ` — ${actorName.get(b.reviewed_by) ?? "—"}` : ""}</span>}
        {payments && payments.payment_state !== "NONE" && (
          <span className={`badge ${PAYROLL_PAYMENT_STATE_TONE[payments.payment_state]}`}>{PAYROLL_PAYMENT_STATE_LABEL[payments.payment_state]}</span>
        )}
        {b.approved_at && <span className="badge status-final">تأیید نهایی {formatJalali(b.approved_at)}{b.approved_by ? ` — ${actorName.get(b.approved_by) ?? "—"}` : ""}</span>}
      </div>

      {stale && (
        <div className="mb-4 rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-4 py-3 text-sm text-ink">
          <p className="font-medium">نتایج قدیمی است؛ پس از آخرین محاسبه این موارد تغییر کرده‌اند:</p>
          <ul className="mt-1 list-disc ps-5 text-ink-muted">{r.stale.map((s) => (<li key={s}>{PAYROLL_STALE_REASON_LABEL[s] ?? s}</li>))}</ul>
          <p className="mt-1 text-xs text-ink-muted">تا محاسبهٔ مجدد، ارسال برای بررسی و ثبت «بررسی‌شد» ممکن نیست.</p>
        </div>
      )}
      {hasCalc && r.critical_count > 0 && (
        <div className="mb-4 rounded-lg border border-status-cancelled/40 bg-status-cancelled/5 px-4 py-3 text-sm text-status-cancelled">
          {toFaDigits(r.critical_count)} هشدار بحرانی وجود دارد. مبلغ اقلام مربوط محاسبه نشده است و تا رفع آن‌ها این دسته نباید نهایی شود.
        </div>
      )}
      {(r.sod.reviewer_is_submitter || r.sod.approver_is_submitter || r.sod.approver_is_reviewer) && (
        <div className="mb-4 rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-4 py-3 text-sm text-ink">
          <p className="font-medium">هشدار تفکیک وظایف (ثبت می‌شود، مانع نیست):</p>
          <ul className="mt-1 list-disc ps-5 text-ink-muted">
            {r.sod.reviewer_is_submitter && <li>ارسال‌کننده و «بررسی‌کننده» یک نفر هستند.</li>}
            {r.sod.approver_is_submitter && <li>ارسال‌کننده و تأییدکنندهٔ نهایی یک نفر هستند.</li>}
            {r.sod.approver_is_reviewer && <li>بررسی‌کننده و تأییدکنندهٔ نهایی یک نفر هستند.</li>}
          </ul>
        </div>
      )}
      {b.status_note && <p className="mb-4 text-xs text-ink-muted">یادداشت وضعیت: {b.status_note}</p>}

      {hasCalc && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="تعداد افراد" value={toFaDigits(r.totals.personnel_count)} />
          <StatCard label={`جمع ناخالص (${unit})`} value={formatExactAmount(r.totals.gross)} />
          <StatCard label={`جمع کسورات (${unit})`} value={formatExactAmount(r.totals.deductions)} />
          <StatCard label={`جمع خالص (${unit})`} value={formatExactAmount(r.totals.net)} tone="seal" />
          <StatCard label={`هزینهٔ کارفرما (${unit})`} value={formatExactAmount(r.totals.employer_cost)} />
        </div>
      )}
      {hasCalc && <p className="mb-4 text-xs text-ink-muted">جمع‌ها فقط جمع ساده‌ٔ اقلام گردشده است و فقط اقلام محاسبه‌شده را شامل می‌شود.</p>}

      <Card className="mb-6">
        <BatchActions batchId={b.id} status={status} stale={stale} reviewed={!!b.reviewed_at} blockers={r.approval_blockers}
          canCreate={access.create} canApprove={access.approve} canAdmin={access.admin} />
      </Card>
      {payments && (
        <div className="mb-6">
          <PaymentsCard batchId={b.id} currency={b.currency} summary={payments} banks={(banks ?? []) as BankAccountOption[]}
            canCreate={access.approve && acc.create} canOpenAccounting={acc.open} defaultDateISO={new Date().toISOString().slice(0, 10)} />
        </div>
      )}
      {payslipRows && (
        <div className="mb-6">
          <PayslipsCard batchId={b.id} rows={payslipRows} canIssue={access.approve} />
        </div>
      )}
      {readiness && (
        <div className="mb-6">
          <AccountingCard batchId={b.id} readiness={readiness as AccountingReadiness} canDraft={access.approve && acc.create}
            canOpenAccounting={acc.open} canAdminPayroll={access.admin} />
        </div>
      )}

      <Tabs tabs={[
        {
          label: "نتایج",
          content: <ResultsTable batchId={b.id} results={r.results} currency={b.currency} hasPrevious={r.previous_period !== null} />,
        },
        {
          label: `هشدارها${r.warnings.length ? ` (${toFaDigits(r.warnings.length)})` : ""}`,
          content: <WarningsList warnings={r.warnings} names={names} />,
        },
        {
          label: "شمول و استثنا",
          content: (
            <EligibilityPanel batchId={b.id} overrides={r.overrides} members={r.results} candidates={[...candMap.values()]}
              canOverride={access.approve} editable={editable} />
          ),
        },
        ...(editable && access.create ? [{
          label: "تنظیمات",
          content: (
            <Card>
              <BatchSettingsForm batchId={b.id} jurisdiction={b.jurisdiction} roundingScale={b.rounding_scale} roundingMode={b.rounding_mode} jurisdictions={jurisdictions} />
            </Card>
          ),
        }] : []),
      ]} />
    </div>
  );
}

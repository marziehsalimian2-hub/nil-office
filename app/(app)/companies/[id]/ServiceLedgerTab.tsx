"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { createClientServiceFile, updateClientServiceFile } from "@/app/actions/service-ledger-files";
import { createServiceArrangement } from "@/app/actions/service-arrangements";
import { deleteServiceEntry, bulkMarkServiceEntriesReadyToBill, waiveServiceEntry, updateServiceEntryFinancials } from "@/app/actions/service-entries";
import { bulkMarkServiceExpensesReadyToBill, waiveServiceExpense, updateExpenseReimbursable } from "@/app/actions/service-expenses";
import { QuickAddServiceEntry } from "./QuickAddServiceEntry";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { PeriodFilter } from "@/components/PeriodFilter";
import { formatJalali } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import type { PeriodPreset } from "@/lib/service-ledger/period";
import {
  CLIENT_SERVICE_STATUS,
  CLIENT_SERVICE_STATUS_LABEL,
  CLIENT_SERVICE_STATUS_TONE,
  SERVICE_ARRANGEMENT_TYPE,
  SERVICE_ARRANGEMENT_TYPE_LABEL,
  SERVICE_ENTRY_STATUS_LABEL,
  BILLING_STATUS_LABEL,
  BILLING_STATUS_TONE,
} from "@/lib/enums";
import type {
  ClientServiceFile,
  ServiceArrangement,
  ServiceCategory,
  ServiceEntry,
  TimeEntry,
  Expense,
  ServiceLedgerClaimableAmountRow,
  ServiceLedgerPeriodSummaryRow,
  ServiceLedgerProfitabilityRow,
} from "@/lib/types/database";

type Opt = { id: string; label: string };
type ServiceEntryRow = ServiceEntry & {
  service_categories: { name: string } | { name: string }[] | null;
  time_entries: TimeEntry[];
  expenses: Expense[];
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

function ClientServiceFileHeader({
  companyId,
  file,
  canManage,
  profiles,
}: {
  companyId: string;
  file: ClientServiceFile;
  canManage: boolean;
  profiles: Opt[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateClientServiceFile(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setEditing(false);
        router.refresh();
      }
    });
  }

  const managerLabel = profiles.find((p) => p.id === file.relationship_manager)?.label ?? "—";

  if (editing) {
    return (
      <form onSubmit={handleSubmit}>
        <input type="hidden" name="id" value={file.id} />
        <input type="hidden" name="company_id" value={companyId} />
        <Card className="space-y-4">
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="وضعیت">
              <select name="status" className="input" defaultValue={file.status}>
                {CLIENT_SERVICE_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {CLIENT_SERVICE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="مسئول رابطه">
              <select name="relationship_manager" className="input" defaultValue={file.relationship_manager ?? ""}>
                <option value="">—</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="واحد پول پیش‌فرض">
              <input name="default_currency" defaultValue={file.default_currency} className="input tnum" dir="ltr" />
            </Field>
          </div>
          <Field label="یادداشت">
            <textarea name="notes" rows={2} defaultValue={file.notes ?? ""} className="input" />
          </Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "در حال ذخیره…" : "ذخیره تغییرات"}
            </button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setEditing(false)}>
              انصراف
            </button>
          </div>
        </Card>
      </form>
    );
  }

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between">
        <p className="text-sm font-medium text-ink">پروندهٔ خدمات مشتری</p>
        {canManage && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> ویرایش
          </button>
        )}
      </div>
      <Row label="وضعیت">
        <span className={`badge bg-paper ${CLIENT_SERVICE_STATUS_TONE[file.status]}`}>{CLIENT_SERVICE_STATUS_LABEL[file.status]}</span>
      </Row>
      <Row label="مسئول رابطه">{managerLabel}</Row>
      <Row label="واحد پول پیش‌فرض">{file.default_currency}</Row>
      <Row label="تاریخ شروع">{formatJalali(file.opened_at)}</Row>
      {file.notes && (
        <div className="py-2.5">
          <p className="mb-1 text-sm text-ink-muted">یادداشت</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{file.notes}</p>
        </div>
      )}
    </Card>
  );
}

function StartServiceFile({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function start() {
    const fd = new FormData();
    fd.append("company_id", companyId);
    fd.append("status", "ACTIVE");
    fd.append("default_currency", "IRR");
    startTransition(async () => {
      const res = await createClientServiceFile(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <p className="mb-3 text-sm text-ink-muted">برای این شرکت هنوز پروندهٔ خدمات مشتری باز نشده است.</p>
      <FormError message={error} />
      {canManage ? (
        <button type="button" disabled={pending} className="btn-primary" onClick={start}>
          {pending ? "در حال ایجاد…" : "شروع پروندهٔ خدمات"}
        </button>
      ) : (
        <p className="text-xs text-ink-muted">این عملیات نیاز به دسترسی «ثبت» یا بالاتر در ماژول خدمات مشتری دارد.</p>
      )}
    </Card>
  );
}

function ClaimableSummaryCard({ rows }: { rows: ServiceLedgerClaimableAmountRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">خلاصهٔ مبالغ قابل مطالبه</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.currency_code} className="rounded-lg border border-paper-line bg-paper/40 p-3">
            <p className="mb-2 text-xs font-medium text-ink-muted" dir="ltr">
              {r.currency_code}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <p className="text-ink-muted">حق‌الزحمه</p>
                <p className="tnum text-ink">{formatMoney(r.service_fee)}</p>
              </div>
              <div>
                <p className="text-ink-muted">ارزش زمان قابل مطالبه</p>
                <p className="tnum text-ink">{formatMoney(r.billable_time_amount)}</p>
              </div>
              <div>
                <p className="text-ink-muted">هزینهٔ قابل بازپرداخت</p>
                <p className="tnum text-ink">{formatMoney(r.reimbursable_expense_amount)}</p>
              </div>
              <div>
                <p className="text-ink-muted">جمع قابل مطالبه</p>
                <p className="tnum font-medium text-seal">{formatMoney(r.claimable_total)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * The period-scoped Executive Summary (spec §23/§24/§26) — distinct from
 * ClaimableSummaryCard above, which is the always-current LIFETIME total.
 * This card is date-filtered via PeriodFilter's own `?period=` query
 * param convention, and — only for ADMIN-tier service_ledger_role —
 * shows Client Profitability, rendering "اطلاعات کافی برای محاسبه
 * سودآوری وجود ندارد" per currency whenever get_client_service_profitability
 * reports data_complete=false (never silently treating a missing
 * internal cost rate as zero cost).
 */
function PeriodExecutiveSummaryCard({
  periodParam,
  periodSummary,
  canViewProfitability,
  profitability,
}: {
  periodParam: PeriodPreset;
  periodSummary: ServiceLedgerPeriodSummaryRow[];
  canViewProfitability: boolean;
  profitability: ServiceLedgerProfitabilityRow[];
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">خلاصهٔ اجرایی بازه</p>
      </div>
      <div className="mb-4">
        <PeriodFilter current={periodParam} />
      </div>
      {periodSummary.length === 0 ? (
        <p className="text-sm text-ink-muted">در این بازه خدمتی ثبت نشده است.</p>
      ) : (
        <div className="space-y-3">
          {periodSummary.map((r) => (
            <div key={r.currency_code} className="rounded-lg border border-paper-line bg-paper/40 p-3">
              <p className="mb-2 text-xs font-medium text-ink-muted" dir="ltr">
                {r.currency_code}
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-7">
                <div>
                  <p className="text-ink-muted">حق‌الزحمه</p>
                  <p className="tnum text-ink">{formatMoney(r.service_fee)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">ارزش زمان</p>
                  <p className="tnum text-ink">{formatMoney(r.billable_time_amount)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">هزینهٔ قابل بازپرداخت</p>
                  <p className="tnum text-ink">{formatMoney(r.reimbursable_expense_amount)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">صورتحساب‌شده</p>
                  <p className="tnum text-status-final">{formatMoney(r.invoiced_amount)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">صورتحساب‌نشده</p>
                  <p className="tnum font-medium text-seal">{formatMoney(r.unbilled_amount)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">وصول‌شده</p>
                  <p className="tnum text-status-received">{formatMoney(r.received_amount)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">مانده وصول</p>
                  <p className="tnum font-medium text-seal">{formatMoney(r.invoiced_amount - r.received_amount)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canViewProfitability && (
        <div className="mt-5 border-t border-paper-line pt-4">
          <p className="mb-3 text-sm font-medium text-ink">سودآوری (محرمانه)</p>
          {profitability.length === 0 ? (
            <p className="text-sm text-ink-muted">در این بازه دادهٔ سودآوری وجود ندارد.</p>
          ) : (
            <div className="space-y-3">
              {profitability.map((p) => (
                <div key={p.currency_code} className="rounded-lg border border-paper-line bg-paper/40 p-3">
                  <p className="mb-2 text-xs font-medium text-ink-muted" dir="ltr">
                    {p.currency_code}
                  </p>
                  {!p.data_complete ? (
                    <p className="text-xs text-status-waiting">اطلاعات کافی برای محاسبه سودآوری وجود ندارد.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div>
                        <p className="text-ink-muted">درآمد</p>
                        <p className="tnum text-ink">{formatMoney(p.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-ink-muted">هزینهٔ داخلی زمان</p>
                        <p className="tnum text-ink">{formatMoney(p.internal_time_cost)}</p>
                      </div>
                      <div>
                        <p className="text-ink-muted">هزینهٔ مستقیم غیرقابل‌بازپرداخت</p>
                        <p className="tnum text-ink">{formatMoney(p.non_reimbursed_direct_cost)}</p>
                      </div>
                      <div>
                        <p className="text-ink-muted">حاشیهٔ سود</p>
                        <p className={`tnum font-medium ${p.contribution_margin >= 0 ? "text-status-final" : "text-status-cancelled"}`}>
                          {formatMoney(p.contribution_margin)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ArrangementsCard({
  companyId,
  clientServiceFileId,
  arrangements,
}: {
  companyId: string;
  clientServiceFileId: string;
  arrangements: ServiceArrangement[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createServiceArrangement(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setAdding(false);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">نحوهٔ ارائهٔ خدمات (Service Arrangements)</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> جدید
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="client_service_file_id" value={clientServiceFileId} />
          <FormError message={error} />
          <Field label="عنوان" required>
            <input name="title" required className="input" placeholder="مثلاً مشاوره و خدمات اجرایی ماهانه" />
          </Field>
          <Field label="نوع" required>
            <select name="arrangement_type" className="input" defaultValue="RETAINER">
              {SERVICE_ARRANGEMENT_TYPE.map((t) => (
                <option key={t} value={t}>
                  {SERVICE_ARRANGEMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "در حال ذخیره…" : "ثبت"}
            </button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setAdding(false)}>
              انصراف
            </button>
          </div>
        </form>
      )}
      {arrangements.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">قراردادی برای نحوهٔ ارائهٔ خدمات ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {arrangements.map((a) => (
            <li key={a.id} className="py-2.5">
              <p className="text-sm text-ink">{a.title}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{SERVICE_ARRANGEMENT_TYPE_LABEL[a.arrangement_type]}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** key format matches the Phase 2 plan's unified selection set — "ENTRY:<id>" / "EXPENSE:<id>", split into the two bulk calls on submit. */
/** Follow-up edit for an entry created through Quick Add without a fee/rate — one submit updates service_fee and (if the entry has a time entry) that time entry's hourly_rate_snapshot together. */
function EditEntryFinancialsForm({
  companyId,
  entry,
  onDone,
}: {
  companyId: string;
  entry: ServiceEntryRow;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const timeEntryId = entry.time_entries[0]?.id;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateServiceEntryFinancials(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mr-7 mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-paper-line bg-paper/40 p-2">
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="company_id" value={companyId} />
      {timeEntryId && <input type="hidden" name="time_entry_id" value={timeEntryId} />}
      <FormError message={error} />
      <Field label="حق‌الزحمه">
        <input type="number" name="service_fee" min={0} step="any" defaultValue={entry.service_fee || undefined} className="input tnum w-32" />
      </Field>
      {timeEntryId && (
        <Field label="نرخ ساعتی">
          <input type="number" name="hourly_rate" min={0} step="any" defaultValue={entry.time_entries[0]?.hourly_rate_snapshot ?? undefined} className="input tnum w-32" />
        </Field>
      )}
      <button type="submit" disabled={pending} className="btn-seal !py-1.5 text-xs">
        {pending ? "در حال ذخیره…" : "ذخیره"}
      </button>
      <button type="button" disabled={pending} className="btn-quiet !py-1.5 text-xs" onClick={onDone}>
        انصراف
      </button>
    </form>
  );
}

/** Follow-up edit for an expense created through Quick Add without is_reimbursable set. */
function EditExpenseReimbursableForm({
  companyId,
  expense,
  onDone,
}: {
  companyId: string;
  expense: Expense;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [isReimbursable, setIsReimbursable] = useState(expense.is_reimbursable);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateExpenseReimbursable(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border border-paper-line bg-paper/40 p-2">
      <input type="hidden" name="id" value={expense.id} />
      <input type="hidden" name="company_id" value={companyId} />
      <FormError message={error} />
      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <input
          type="checkbox"
          name="is_reimbursable"
          value="true"
          className="h-4 w-4 accent-[#9a6a2e]"
          checked={isReimbursable}
          onChange={(e) => setIsReimbursable(e.target.checked)}
        />
        قابل بازپرداخت از مشتری
      </label>
      {isReimbursable && (
        <Field label="مبلغ قابل بازپرداخت">
          <input type="number" name="reimbursable_amount" min={0} step="any" defaultValue={expense.reimbursable_amount ?? expense.amount} className="input tnum w-32" />
        </Field>
      )}
      <button type="submit" disabled={pending} className="btn-seal !py-1.5 text-xs">
        {pending ? "در حال ذخیره…" : "ذخیره"}
      </button>
      <button type="button" disabled={pending} className="btn-quiet !py-1.5 text-xs" onClick={onDone}>
        انصراف
      </button>
    </form>
  );
}

function ServiceEntriesCard({ companyId, entries, canManage }: { companyId: string; entries: ServiceEntryRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [editingEntry, setEditingEntry] = useState<string>();
  const [editingExpense, setEditingExpense] = useState<string>();

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheck(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function remove(id: string) {
    if (!confirm("حذف این خدمت؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("company_id", companyId);
    startTransition(async () => {
      await deleteServiceEntry(null, fd);
      router.refresh();
    });
  }

  function waive(kind: "ENTRY" | "EXPENSE", id: string) {
    const reason = window.prompt("دلیل بخشش این ردیف چیست؟");
    if (!reason || !reason.trim()) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("company_id", companyId);
    fd.append("reason", reason.trim());
    startTransition(async () => {
      const action = kind === "ENTRY" ? waiveServiceEntry : waiveServiceExpense;
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  function markReady() {
    const entryIds = [...checked].filter((k) => k.startsWith("ENTRY:")).map((k) => k.slice(6));
    const expenseIds = [...checked].filter((k) => k.startsWith("EXPENSE:")).map((k) => k.slice(8));
    startTransition(async () => {
      let anyError: string | undefined;
      if (entryIds.length > 0) {
        const fd = new FormData();
        fd.append("company_id", companyId);
        fd.append("ids", JSON.stringify(entryIds));
        const res = await bulkMarkServiceEntriesReadyToBill(null, fd);
        if (res && "error" in res && res.error) anyError = res.error;
      }
      if (expenseIds.length > 0) {
        const fd = new FormData();
        fd.append("company_id", companyId);
        fd.append("ids", JSON.stringify(expenseIds));
        const res = await bulkMarkServiceExpensesReadyToBill(null, fd);
        if (res && "error" in res && res.error) anyError = res.error;
      }
      if (anyError) setError(anyError);
      else {
        setError(undefined);
        setChecked(new Set());
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">خدمات ثبت‌شده</p>
        <Link href="/service-ledger/billing-batches" className="text-xs text-seal hover:underline">
          مشاهدهٔ دسته‌های صورتحساب
        </Link>
      </div>
      <FormError message={error} />
      {canManage && checked.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <span className="text-xs text-ink-muted">{checked.size} ردیف انتخاب‌شده</span>
          <button type="button" disabled={pending} className="btn-seal !py-1.5 text-xs" onClick={markReady}>
            علامت‌گذاری به‌عنوان آمادهٔ صورتحساب
          </button>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز خدمتی برای این مشتری ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {entries.map((e) => {
            const category = Array.isArray(e.service_categories) ? e.service_categories[0] : e.service_categories;
            const totalMinutes = e.time_entries.reduce((sum, t) => sum + t.duration_minutes, 0);
            const totalExpense = e.expenses.reduce((sum, x) => sum + Number(x.amount), 0);
            const entryKey = `ENTRY:${e.id}`;
            const isOpen = expanded.has(e.id);
            const canWaive = e.billing_status === "BILLABLE" || e.billing_status === "READY_TO_BILL";
            return (
              <li key={e.id} className="py-2.5">
                <div className="flex items-start gap-3">
                  {canManage && (
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[#9a6a2e]" checked={checked.has(entryKey)} onChange={() => toggleCheck(entryKey)} />
                  )}
                  <div className="flex-1">
                    <p className="text-sm text-ink">
                      <span className="text-ink-muted">{category?.name ?? "—"}</span> — {e.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span className="tnum">{formatJalali(e.service_date)}</span>
                      <span>{SERVICE_ENTRY_STATUS_LABEL[e.status]}</span>
                      <span className={`badge bg-paper ${BILLING_STATUS_TONE[e.billing_status]}`}>{BILLING_STATUS_LABEL[e.billing_status]}</span>
                      {totalMinutes > 0 && <span className="tnum">{Math.round(totalMinutes)} دقیقه</span>}
                      {totalExpense > 0 && <span className="tnum">هزینه: {formatMoney(totalExpense)}</span>}
                      {Number(e.service_fee) > 0 && <span className="tnum">حق‌الزحمه: {formatMoney(e.service_fee)}</span>}
                    </p>
                    {e.waived_reason && <p className="mt-0.5 text-xs text-ink-muted">دلیل بخشش: {e.waived_reason}</p>}
                  </div>
                  {e.expenses.length > 0 && (
                    <button type="button" className="btn-quiet p-1.5" aria-label="نمایش هزینه‌ها" onClick={() => toggleExpand(e.id)}>
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  )}
                  {canManage && (
                    <button type="button" disabled={pending} className="btn-quiet p-1.5 text-xs" onClick={() => setEditingEntry(editingEntry === e.id ? undefined : e.id)}>
                      ویرایش مبلغ
                    </button>
                  )}
                  {canManage && canWaive && (
                    <button type="button" disabled={pending} className="btn-quiet p-1.5 text-xs" onClick={() => waive("ENTRY", e.id)}>
                      بخشش
                    </button>
                  )}
                  <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(e.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {editingEntry === e.id && (
                  <EditEntryFinancialsForm companyId={companyId} entry={e} onDone={() => setEditingEntry(undefined)} />
                )}
                {isOpen && e.expenses.length > 0 && (
                  <ul className="mr-7 mt-2 space-y-2 border-r-2 border-paper-line pr-3">
                    {e.expenses.map((x) => {
                      const xKey = `EXPENSE:${x.id}`;
                      const xCanWaive = x.billing_status === "BILLABLE" || x.billing_status === "READY_TO_BILL";
                      return (
                        <li key={x.id}>
                          <div className="flex items-center gap-3">
                            {canManage && (
                              <input type="checkbox" className="h-4 w-4 accent-[#9a6a2e]" checked={checked.has(xKey)} onChange={() => toggleCheck(xKey)} />
                            )}
                            <span className="flex-1 text-xs text-ink">{x.description}</span>
                            <span className="tnum text-xs text-ink-muted">{formatMoney(x.amount)}</span>
                            {x.is_reimbursable && <span className="badge bg-paper status-waiting">قابل بازپرداخت</span>}
                            <span className={`badge bg-paper ${BILLING_STATUS_TONE[x.billing_status]}`}>{BILLING_STATUS_LABEL[x.billing_status]}</span>
                            {canManage && (
                              <button
                                type="button"
                                disabled={pending}
                                className="btn-quiet p-1 text-xs"
                                onClick={() => setEditingExpense(editingExpense === x.id ? undefined : x.id)}
                              >
                                ویرایش بازپرداخت
                              </button>
                            )}
                            {canManage && xCanWaive && (
                              <button type="button" disabled={pending} className="btn-quiet p-1 text-xs" onClick={() => waive("EXPENSE", x.id)}>
                                بخشش
                              </button>
                            )}
                          </div>
                          {editingExpense === x.id && (
                            <EditExpenseReimbursableForm companyId={companyId} expense={x} onDone={() => setEditingExpense(undefined)} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function ServiceLedgerTab({
  companyId,
  serviceFile,
  canManage,
  profiles,
  categories,
  arrangements,
  entries,
  claimableSummary,
  periodParam,
  periodSummary,
  canViewProfitability,
  profitability,
}: {
  companyId: string;
  serviceFile: ClientServiceFile | null;
  canManage: boolean;
  profiles: Opt[];
  categories: Pick<ServiceCategory, "id" | "name">[];
  arrangements: ServiceArrangement[];
  entries: ServiceEntryRow[];
  claimableSummary: ServiceLedgerClaimableAmountRow[];
  periodParam: PeriodPreset;
  periodSummary: ServiceLedgerPeriodSummaryRow[];
  canViewProfitability: boolean;
  profitability: ServiceLedgerProfitabilityRow[];
}) {
  if (!serviceFile) {
    return <StartServiceFile companyId={companyId} canManage={canManage} />;
  }

  return (
    <div className="space-y-6">
      <ClientServiceFileHeader companyId={companyId} file={serviceFile} canManage={canManage} profiles={profiles} />
      <ClaimableSummaryCard rows={claimableSummary} />
      <PeriodExecutiveSummaryCard
        periodParam={periodParam}
        periodSummary={periodSummary}
        canViewProfitability={canViewProfitability}
        profitability={profitability}
      />
      {canManage && (
        <QuickAddServiceEntry
          companyId={companyId}
          clientServiceFileId={serviceFile.id}
          categories={categories}
          defaultCurrency={serviceFile.default_currency}
        />
      )}
      <ArrangementsCard companyId={companyId} clientServiceFileId={serviceFile.id} arrangements={arrangements} />
      <ServiceEntriesCard companyId={companyId} entries={entries} canManage={canManage} />
    </div>
  );
}

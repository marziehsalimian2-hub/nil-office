"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createClientServiceFile, updateClientServiceFile } from "@/app/actions/service-ledger-files";
import { createServiceArrangement } from "@/app/actions/service-arrangements";
import { deleteServiceEntry } from "@/app/actions/service-entries";
import { QuickAddServiceEntry } from "./QuickAddServiceEntry";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
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

function ServiceEntriesCard({ companyId, entries }: { companyId: string; entries: ServiceEntryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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

  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">خدمات ثبت‌شده</p>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز خدمتی برای این مشتری ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {entries.map((e) => {
            const category = Array.isArray(e.service_categories) ? e.service_categories[0] : e.service_categories;
            const totalMinutes = e.time_entries.reduce((sum, t) => sum + t.duration_minutes, 0);
            const totalExpense = e.expenses.reduce((sum, x) => sum + Number(x.amount), 0);
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
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
                </div>
                <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(e.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
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
}: {
  companyId: string;
  serviceFile: ClientServiceFile | null;
  canManage: boolean;
  profiles: Opt[];
  categories: Pick<ServiceCategory, "id" | "name">[];
  arrangements: ServiceArrangement[];
  entries: ServiceEntryRow[];
  claimableSummary: ServiceLedgerClaimableAmountRow[];
}) {
  if (!serviceFile) {
    return <StartServiceFile companyId={companyId} canManage={canManage} />;
  }

  return (
    <div className="space-y-6">
      <ClientServiceFileHeader companyId={companyId} file={serviceFile} canManage={canManage} profiles={profiles} />
      <ClaimableSummaryCard rows={claimableSummary} />
      {canManage && (
        <QuickAddServiceEntry
          companyId={companyId}
          clientServiceFileId={serviceFile.id}
          categories={categories}
          defaultCurrency={serviceFile.default_currency}
        />
      )}
      <ArrangementsCard companyId={companyId} clientServiceFileId={serviceFile.id} arrangements={arrangements} />
      <ServiceEntriesCard companyId={companyId} entries={entries} />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmploymentRecord, changePersonnelStatus } from "@/app/actions/employment";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { PERSONNEL_STATUS, PERSONNEL_STATUS_LABEL, PERSONNEL_EMPLOYMENT_TYPE, PERSONNEL_EMPLOYMENT_TYPE_LABEL, type PersonnelStatus } from "@/lib/enums";

type Opt = { id: string; label: string };

export function EmploymentActions({
  personnelId,
  currentStatus,
  managers,
}: {
  personnelId: string;
  currentStatus: PersonnelStatus;
  managers: Opt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const [showStatus, setShowStatus] = useState(false);
  const [newStatus, setNewStatus] = useState<PersonnelStatus>(currentStatus);
  const [showNewRecord, setShowNewRecord] = useState(false);

  const isRehire = currentStatus === "TERMINATED" && newStatus === "ACTIVE";

  function run(action: (p: null, f: FormData) => Promise<{ error?: string } | null>, fd: FormData, onDone?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        onDone?.();
        router.refresh();
      }
    });
  }

  function handleStatusSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("personnel_id", personnelId);
    run(changePersonnelStatus, fd, () => setShowStatus(false));
  }

  function handleNewRecordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("personnel_id", personnelId);
    run(createEmploymentRecord, fd, () => setShowNewRecord(false));
  }

  return (
    <Card className="space-y-4">
      <p className="text-sm font-medium text-ink">اقدامات</p>
      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className="btn-quiet" onClick={() => setShowStatus((v) => !v)}>
          تغییر وضعیت اشتغال
        </button>
        <button type="button" disabled={pending} className="btn-quiet" onClick={() => setShowNewRecord((v) => !v)}>
          ثبت تغییر شغلی
        </button>
      </div>

      {showStatus && (
        <form onSubmit={handleStatusSubmit} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <Field label="وضعیت جدید" required>
            <select name="new_status" required className="input" value={newStatus} onChange={(e) => setNewStatus(e.target.value as PersonnelStatus)}>
              {PERSONNEL_STATUS.map((s) => (<option key={s} value={s}>{PERSONNEL_STATUS_LABEL[s]}</option>))}
            </select>
          </Field>
          <Field label="تاریخ اثر"><JalaliDateInput name="effective_date" /></Field>
          <Field label="دلیل"><input name="reason" className="input" /></Field>

          {isRehire && (
            <div className="space-y-3 rounded-lg border border-paper-line bg-paper p-3">
              <p className="text-xs font-medium text-ink-muted">بازگشت به کار — اطلاعات اشتغال جدید</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="سمت" required><input name="job_title" required className="input" /></Field>
                <Field label="نوع همکاری" required>
                  <select name="employment_type" required className="input" defaultValue="">
                    <option value="" disabled>— انتخاب —</option>
                    {PERSONNEL_EMPLOYMENT_TYPE.map((t) => (<option key={t} value={t}>{PERSONNEL_EMPLOYMENT_TYPE_LABEL[t]}</option>))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="واحد"><input name="department" className="input" /></Field>
                <Field label="مدیر مستقیم">
                  <select name="manager_personnel_id" className="input" defaultValue=""><option value="">—</option>
                    {managers.map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
                  </select>
                </Field>
              </div>
            </div>
          )}

          <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-xs">{pending ? "در حال ذخیره…" : "ثبت تغییر وضعیت"}</button>
        </form>
      )}

      {showNewRecord && (
        <form onSubmit={handleNewRecordSubmit} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="سمت جدید" required><input name="job_title" required className="input" /></Field>
            <Field label="نوع همکاری" required>
              <select name="employment_type" required className="input" defaultValue="">
                <option value="" disabled>— انتخاب —</option>
                {PERSONNEL_EMPLOYMENT_TYPE.map((t) => (<option key={t} value={t}>{PERSONNEL_EMPLOYMENT_TYPE_LABEL[t]}</option>))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="واحد"><input name="department" className="input" /></Field>
            <Field label="مدیر مستقیم">
              <select name="manager_personnel_id" className="input" defaultValue=""><option value="">—</option>
                {managers.map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
              </select>
            </Field>
          </div>
          <Field label="تاریخ اجرا" required><JalaliDateInput name="start_date" required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ساعات کاری استاندارد (ماهانه)"><input name="standard_monthly_hours" type="number" step="0.5" className="input tnum" /></Field>
            <Field label="نوع برنامهٔ کاری"><input name="work_schedule_type" className="input" /></Field>
          </div>
          <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-xs">{pending ? "در حال ذخیره…" : "ثبت رکورد اشتغال جدید"}</button>
        </form>
      )}
    </Card>
  );
}

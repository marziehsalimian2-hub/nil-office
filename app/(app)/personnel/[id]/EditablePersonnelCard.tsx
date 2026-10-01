"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updatePersonnel } from "@/app/actions/personnel";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { formatJalali, toFaDigits } from "@/lib/jalali";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export function EditablePersonnelCard({
  id,
  view,
}: {
  id: string;
  view: {
    personnel_number: string;
    first_name: string;
    last_name: string;
    job_title: string;
    department: string | null;
    mobile: string | null;
    email: string | null;
    address: string | null;
    work_location: string | null;
    notes: string | null;
    hire_date: string;
  };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updatePersonnel(null, formData);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Card className="space-y-4">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام" required><input name="first_name" required defaultValue={view.first_name} className="input" /></Field>
            <Field label="نام خانوادگی" required><input name="last_name" required defaultValue={view.last_name} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="تاریخ استخدام" required><JalaliDateInput name="hire_date" required defaultISO={view.hire_date} /></Field>
            <Field label="محل کار"><input name="work_location" defaultValue={view.work_location ?? ""} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="موبایل"><input name="mobile" dir="ltr" defaultValue={view.mobile ?? ""} className="input tnum" /></Field>
            <Field label="ایمیل"><input name="email" dir="ltr" defaultValue={view.email ?? ""} className="input" /></Field>
          </div>
          <Field label="آدرس"><textarea name="address" rows={2} defaultValue={view.address ?? ""} className="input" /></Field>
          <Field label="یادداشت"><textarea name="notes" rows={2} defaultValue={view.notes ?? ""} className="input" /></Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره تغییرات"}</button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setEditing(false)}>انصراف</button>
          </div>
        </Card>
      </form>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">اطلاعات پرسنل</p>
        <button type="button" className="btn-quiet !py-1 text-xs" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" /> ویرایش
        </button>
      </div>
      <div>
        <Row label="شماره پرسنلی"><span className="tnum" dir="ltr">{toFaDigits(view.personnel_number)}</span></Row>
        <Row label="نام کامل">{view.first_name} {view.last_name}</Row>
        <Row label="سمت">{view.job_title}</Row>
        <Row label="واحد">{view.department ?? "—"}</Row>
        <Row label="تاریخ استخدام"><span className="tnum">{formatJalali(view.hire_date)}</span></Row>
        <Row label="محل کار">{view.work_location ?? "—"}</Row>
        <Row label="موبایل"><span dir="ltr">{view.mobile ?? "—"}</span></Row>
        <Row label="ایمیل"><span dir="ltr">{view.email ?? "—"}</span></Row>
        <Row label="آدرس">{view.address ?? "—"}</Row>
        <Row label="یادداشت">{view.notes ?? "—"}</Row>
      </div>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ShieldAlert } from "lucide-react";
import { updatePersonnelSensitive } from "@/app/actions/personnel-sensitive";
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

/** ADMIN-tier hr_role only — only rendered by the parent page when the viewer already passed that check; RLS (0112_personnel_rls.sql) is the real gate underneath regardless. */
export function SensitiveDetailsCard({
  personnelId,
  view,
}: {
  personnelId: string;
  view: {
    national_id: string | null;
    passport_number: string | null;
    birth_date: string | null;
    emergency_contact: string | null;
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
      const res = await updatePersonnelSensitive(null, formData);
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
        <input type="hidden" name="personnel_id" value={personnelId} />
        <Card className="space-y-4 border-status-cancelled/30">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="کد ملی"><input name="national_id" dir="ltr" defaultValue={view.national_id ?? ""} className="input tnum" /></Field>
            <Field label="شماره پاسپورت"><input name="passport_number" dir="ltr" defaultValue={view.passport_number ?? ""} className="input tnum" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="تاریخ تولد"><JalaliDateInput name="birth_date" defaultISO={view.birth_date ?? undefined} /></Field>
            <Field label="تماس اضطراری"><input name="emergency_contact" className="input" /></Field>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره تغییرات"}</button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setEditing(false)}>انصراف</button>
          </div>
        </Card>
      </form>
    );
  }

  return (
    <Card className="border-status-cancelled/30">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <ShieldAlert className="h-4 w-4 text-status-cancelled" /> اطلاعات محرمانه
        </p>
        <button type="button" className="btn-quiet !py-1 text-xs" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" /> ویرایش
        </button>
      </div>
      <div>
        <Row label="کد ملی"><span className="tnum" dir="ltr">{view.national_id ? toFaDigits(view.national_id) : "—"}</span></Row>
        <Row label="شماره پاسپورت"><span className="tnum" dir="ltr">{view.passport_number ? toFaDigits(view.passport_number) : "—"}</span></Row>
        <Row label="تاریخ تولد">{view.birth_date ? <span className="tnum">{formatJalali(view.birth_date)}</span> : "—"}</Row>
        <Row label="تماس اضطراری">{view.emergency_contact ?? "—"}</Row>
      </div>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { updateContract } from "@/app/actions/contracts";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { Card } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import { formatMoney, type DisplayUnit } from "@/lib/money";

type Opt = { id: string; label: string };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export function EditableContractCard({
  id,
  canEdit,
  types,
  companies,
  cases,
  profiles,
  unit,
  view,
}: {
  id: string;
  canEdit: boolean;
  types: Opt[];
  companies: Opt[];
  cases: Opt[];
  profiles: Opt[];
  unit: DisplayUnit;
  view: {
    title: string;
    contractTypeId: string;
    typeLabel: string | null;
    partyCompanyId: string | null;
    partyLabel: string | null;
    partyContactName: string | null;
    caseId: string | null;
    caseLabel: string | null;
    contractDate: string | null;
    effectiveDate: string | null;
    startDate: string | null;
    endDate: string | null;
    baseAmount: number | null;
    taxAmount: number | null;
    totalAmount: number | null;
    responsibleUserId: string | null;
    responsibleLabel: string | null;
    requiresGuarantee: boolean;
    autoRenewal: boolean;
    description: string | null;
    internalNotes: string | null;
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
      const res = await updateContract(null, formData);
      if (res && "error" in res && res.error) {
        setError(res.error);
      } else {
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

          <Field label="عنوان قرارداد" required>
            <input name="title" required defaultValue={view.title} className="input" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع قرارداد" required>
              <select name="contract_type_id" required className="input" defaultValue={view.contractTypeId}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="طرف قرارداد (شرکت)">
              <select name="party_company_id" className="input" defaultValue={view.partyCompanyId ?? ""}>
                <option value="">— انتخاب شرکت —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام/سمت نمایندهٔ طرف قرارداد">
              <input name="party_contact_name" className="input" defaultValue={view.partyContactName ?? ""} />
            </Field>
            <Field label="پرونده مرتبط">
              <select name="case_id" className="input" defaultValue={view.caseId ?? ""}>
                <option value="">— بدون پرونده —</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="تاریخ قرارداد"><JalaliDateInput name="contract_date" defaultISO={view.contractDate} /></Field>
            <Field label="تاریخ نفوذ"><JalaliDateInput name="effective_date" defaultISO={view.effectiveDate} /></Field>
            <Field label="تاریخ شروع"><JalaliDateInput name="start_date" defaultISO={view.startDate} /></Field>
            <Field label="تاریخ پایان"><JalaliDateInput name="end_date" defaultISO={view.endDate} /></Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="مبلغ پایه"><MoneyInput name="base_amount" defaultValue={view.baseAmount ? String(view.baseAmount) : ""} /></Field>
            <Field label="مالیات/ارزش‌افزوده"><MoneyInput name="tax_amount" defaultValue={view.taxAmount ? String(view.taxAmount) : ""} /></Field>
            <Field label="مبلغ نهایی"><MoneyInput name="total_amount" defaultValue={view.totalAmount ? String(view.totalAmount) : ""} /></Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="مسئول قرارداد">
              <select name="responsible_user_id" className="input" defaultValue={view.responsibleUserId ?? ""}>
                <option value="">— انتخاب —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>
            <div className="flex items-end gap-5 pb-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="requires_guarantee" value="true" defaultChecked={view.requiresGuarantee} className="h-4 w-4 accent-[#9a6a2e]" />
                <span className="text-sm text-ink">نیاز به ضمانت‌نامه</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="auto_renewal" value="true" defaultChecked={view.autoRenewal} className="h-4 w-4 accent-[#9a6a2e]" />
                <span className="text-sm text-ink">تمدید خودکار</span>
              </label>
            </div>
          </div>

          <Field label="شرح قرارداد">
            <textarea name="description" rows={3} className="input" defaultValue={view.description ?? ""} />
          </Field>
          <Field label="یادداشت داخلی">
            <textarea name="internal_notes" rows={2} className="input" defaultValue={view.internalNotes ?? ""} />
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
        <p className="text-sm font-medium text-ink">اطلاعات قرارداد</p>
        {canEdit && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> ویرایش
          </button>
        )}
      </div>
      <Row label="عنوان">{view.title}</Row>
      <Row label="نوع قرارداد">{view.typeLabel || "—"}</Row>
      <Row label="طرف قرارداد">{view.partyLabel || view.partyContactName || "—"}</Row>
      <Row label="پرونده">
        {view.caseId ? (
          <Link href={`/cases/${view.caseId}`} className="text-seal hover:underline">{view.caseLabel}</Link>
        ) : (
          "—"
        )}
      </Row>
      <Row label="تاریخ قرارداد">{formatJalali(view.contractDate)}</Row>
      <Row label="تاریخ نفوذ">{formatJalali(view.effectiveDate)}</Row>
      <Row label="تاریخ شروع">{formatJalali(view.startDate)}</Row>
      <Row label="تاریخ پایان">{formatJalali(view.endDate)}</Row>
      <Row label="مبلغ پایه">{formatMoney(view.baseAmount, unit)}</Row>
      <Row label="مالیات/ارزش‌افزوده">{formatMoney(view.taxAmount, unit)}</Row>
      <Row label="مبلغ نهایی">{formatMoney(view.totalAmount, unit)}</Row>
      <Row label="مسئول قرارداد">{view.responsibleLabel || "—"}</Row>
      <Row label="نیاز به ضمانت‌نامه">{view.requiresGuarantee ? "بله" : "خیر"}</Row>
      <Row label="تمدید خودکار">{view.autoRenewal ? "بله" : "خیر"}</Row>
      {view.description && <Row label="شرح">{view.description}</Row>}
      {view.internalNotes && <Row label="یادداشت داخلی">{view.internalNotes}</Row>}
    </Card>
  );
}

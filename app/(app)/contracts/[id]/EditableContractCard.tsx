"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { updateContractDraft } from "@/app/actions/contracts";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { Card } from "@/components/ui";
import { CONTRACT_KIND_LABEL, type ContractKind } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";

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
  kind,
  types,
  companies,
  cases,
  profiles,
  view,
  initial,
}: {
  id: string;
  canEdit: boolean;
  kind: ContractKind;
  types: Opt[];
  companies: Opt[];
  cases: Opt[];
  profiles: Opt[];
  view: {
    title: string;
    typeName: string | null;
    counterparty: string | null;
    counterpartyRepresentativeName: string | null;
    relatedCase: { id: string; label: string } | null;
    responsibleName: string | null;
    signatoryName: string | null;
    signatoryLabel: string | null;
    externalContractNumber: string | null;
    externalSourceNote: string | null;
    signedDate: string | null;
    effectiveDate: string | null;
    expiryDate: string | null;
    description: string | null;
    internalNotes: string | null;
    createdAt: string;
    finalizedAt: string | null;
  };
  initial: {
    contract_type_id: string;
    counterparty_company_id: string | null;
    case_id: string | null;
    responsible_user: string | null;
    signatory_id: string | null;
    base_amount: number | null;
    discount_amount: number;
    tax_amount: number;
    currency_code: string;
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
      const res = await updateContractDraft(null, formData);
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
        <input type="hidden" name="kind" value={kind} />
        <Card className="space-y-4">
          <FormError message={error} />

          <Field label="عنوان قرارداد" required>
            <input name="title" required defaultValue={view.title} className="input" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع قرارداد" required>
              <select name="contract_type_id" required className="input" defaultValue={initial.contract_type_id}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="طرف قرارداد">
              <select name="counterparty_company_id" className="input" defaultValue={initial.counterparty_company_id ?? ""}>
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="نام نمایندهٔ طرف قرارداد" hint="روی برگ خلاصهٔ قرارداد چاپ می‌شود">
            <input
              name="counterparty_representative_name"
              className="input"
              defaultValue={view.counterpartyRepresentativeName ?? ""}
            />
          </Field>

          {kind === "HISTORICAL" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="شمارهٔ اصلی قرارداد" required>
                <input
                  name="external_contract_number"
                  required
                  dir="ltr"
                  className="input text-center tnum"
                  defaultValue={view.externalContractNumber ?? ""}
                />
              </Field>
              <Field label="یادداشت منبع">
                <input name="external_source_note" className="input" defaultValue={view.externalSourceNote ?? ""} />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="پروندهٔ مرتبط">
              <select name="case_id" className="input" defaultValue={initial.case_id ?? ""}>
                <option value="">— بدون پرونده —</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="مسئول قرارداد">
              <select name="responsible_user" className="input" defaultValue={initial.responsible_user ?? ""}>
                <option value="">—</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="امضاکننده" hint="امضای این شخص در برگ خلاصهٔ قرارداد چاپ می‌شود">
              <select name="signatory_id" className="input" defaultValue={initial.signatory_id ?? ""}>
                <option value="">— انتخاب امضاکننده —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>
            <Field label="نام/سمت زیر امضا" hint="هر خط جدا زیر امضا و مهر چاپ می‌شود">
              <textarea name="signatory_label" rows={2} className="input" defaultValue={view.signatoryLabel ?? ""} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="تاریخ عقد">
              <JalaliDateInput name="signed_date" defaultISO={view.signedDate} />
            </Field>
            <Field label="تاریخ شروع">
              <JalaliDateInput name="effective_date" defaultISO={view.effectiveDate} />
            </Field>
            <Field label="تاریخ پایان">
              <JalaliDateInput name="expiry_date" defaultISO={view.expiryDate} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="مبلغ پایه">
              <MoneyInput name="base_amount" defaultValue={initial.base_amount != null ? String(initial.base_amount) : ""} />
            </Field>
            <Field label="تخفیف">
              <MoneyInput name="discount_amount" defaultValue={String(initial.discount_amount)} />
            </Field>
            <Field label="مالیات/ارزش‌افزوده">
              <MoneyInput name="tax_amount" defaultValue={String(initial.tax_amount)} />
            </Field>
          </div>
          <Field label="واحد پول">
            <input name="currency_code" defaultValue={initial.currency_code} dir="ltr" className="input w-32 text-center tnum" />
          </Field>

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
      <Row label="دستهٔ قرارداد">{CONTRACT_KIND_LABEL[kind]}</Row>
      <Row label="نوع قرارداد">{view.typeName || "—"}</Row>
      <Row label="طرف قرارداد">{view.counterparty || "—"}</Row>
      <Row label="نام نمایندهٔ طرف قرارداد">{view.counterpartyRepresentativeName || "—"}</Row>
      {kind === "HISTORICAL" && (
        <>
          <Row label="شمارهٔ اصلی قرارداد">{view.externalContractNumber || "—"}</Row>
          {view.externalSourceNote && <Row label="یادداشت منبع">{view.externalSourceNote}</Row>}
        </>
      )}
      <Row label="پرونده">
        {view.relatedCase ? (
          <Link href={`/cases/${view.relatedCase.id}`} className="text-seal hover:underline">
            {view.relatedCase.label}
          </Link>
        ) : (
          "—"
        )}
      </Row>
      <Row label="مسئول قرارداد">{view.responsibleName || "—"}</Row>
      <Row label="امضاکننده">{view.signatoryName || "—"}</Row>
      <Row label="تاریخ عقد">{formatJalali(view.signedDate)}</Row>
      <Row label="تاریخ شروع">{formatJalali(view.effectiveDate)}</Row>
      <Row label="تاریخ پایان">{formatJalali(view.expiryDate)}</Row>
      <Row label="تاریخ ثبت">{formatJalali(view.createdAt)}</Row>
      {view.finalizedAt && <Row label="تاریخ ثبت نهایی">{formatJalali(view.finalizedAt)}</Row>}
      {view.description && (
        <div className="border-b border-paper-line/60 py-2.5 last:border-0">
          <p className="mb-1 text-sm text-ink-muted">شرح قرارداد</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{view.description}</p>
        </div>
      )}
      {view.internalNotes && (
        <div className="py-2.5">
          <p className="mb-1 text-sm text-ink-muted">یادداشت داخلی</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{view.internalNotes}</p>
        </div>
      )}
    </Card>
  );
}

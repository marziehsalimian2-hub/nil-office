"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateCompanyBase, updateCompanyCrm } from "@/app/actions/crm-companies";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { CrmStatusBadge } from "@/components/CrmStatusBadge";
import { CRM_COMPANY_STATUS, CRM_COMPANY_STATUS_LABEL, CRM_COMPANY_ROLE, CRM_COMPANY_ROLE_LABEL, type CrmCompanyStatus } from "@/lib/enums";

type Opt = { id: string; label: string };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export function EditableCompanyBaseCard({
  id,
  view,
}: {
  id: string;
  view: {
    legal_name: string;
    english_name: string | null;
    country: string | null;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
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
      const res = await updateCompanyBase(null, formData);
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
            <Field label="نام شرکت (حقوقی)" required>
              <input name="legal_name" required defaultValue={view.legal_name} className="input" />
            </Field>
            <Field label="نام انگلیسی">
              <input name="english_name" dir="ltr" defaultValue={view.english_name ?? ""} className="input text-left" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="کشور"><input name="country" defaultValue={view.country ?? ""} className="input" /></Field>
            <Field label="شخص رابط"><input name="contact_person" defaultValue={view.contact_person ?? ""} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ایمیل"><input name="email" dir="ltr" defaultValue={view.email ?? ""} className="input text-left" /></Field>
            <Field label="تلفن"><input name="phone" dir="ltr" defaultValue={view.phone ?? ""} className="input text-left" /></Field>
          </div>
          <Field label="نشانی"><textarea name="address" rows={2} defaultValue={view.address ?? ""} className="input" /></Field>
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
      <div className="mb-1 flex items-start justify-between">
        <p className="text-sm font-medium text-ink">اطلاعات شرکت</p>
        <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" /> ویرایش
        </button>
      </div>
      <Row label="نام حقوقی">{view.legal_name}</Row>
      <Row label="نام انگلیسی">{view.english_name || "—"}</Row>
      <Row label="کشور">{view.country || "—"}</Row>
      <Row label="شخص رابط">{view.contact_person || "—"}</Row>
      <Row label="ایمیل"><span dir="ltr">{view.email || "—"}</span></Row>
      <Row label="تلفن"><span dir="ltr">{view.phone || "—"}</span></Row>
      {view.address && (
        <div className="border-b border-paper-line/60 py-2.5 last:border-0">
          <p className="mb-1 text-sm text-ink-muted">نشانی</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{view.address}</p>
        </div>
      )}
      {view.notes && (
        <div className="py-2.5">
          <p className="mb-1 text-sm text-ink-muted">یادداشت</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{view.notes}</p>
        </div>
      )}
    </Card>
  );
}

export function EditableCompanyCrmCard({
  id,
  canEdit,
  profiles,
  view,
}: {
  id: string;
  canEdit: boolean;
  profiles: Opt[];
  view: {
    crm_status: CrmCompanyStatus;
    owner_user_id: string | null;
    ownerName: string | null;
    roles: string[];
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
      const res = await updateCompanyCrm(null, formData);
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
            <Field label="وضعیت CRM">
              <select name="crm_status" className="input" defaultValue={view.crm_status}>
                {CRM_COMPANY_STATUS.map((s) => (<option key={s} value={s}>{CRM_COMPANY_STATUS_LABEL[s]}</option>))}
              </select>
            </Field>
            <Field label="مالک داخلی">
              <select name="owner_user_id" className="input" defaultValue={view.owner_user_id ?? ""}>
                <option value="">—</option>
                {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
              </select>
            </Field>
          </div>
          <Field label="نقش‌ها">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CRM_COMPANY_ROLE.map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" name="roles" value={r} defaultChecked={view.roles.includes(r)} />
                  {CRM_COMPANY_ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </Field>
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
      <div className="mb-1 flex items-start justify-between">
        <p className="text-sm font-medium text-ink">اطلاعات CRM</p>
        {canEdit && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> ویرایش
          </button>
        )}
      </div>
      <Row label="وضعیت"><CrmStatusBadge status={view.crm_status} /></Row>
      <Row label="مالک داخلی">{view.ownerName || "—"}</Row>
      <Row label="نقش‌ها">
        {view.roles.length === 0 ? "—" : view.roles.map((r) => CRM_COMPANY_ROLE_LABEL[r as keyof typeof CRM_COMPANY_ROLE_LABEL] ?? r).join("، ")}
      </Row>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createActivity, deleteActivity } from "@/app/actions/crm-activities";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { CRM_ACTIVITY_TYPE, CRM_ACTIVITY_TYPE_LABEL, CRM_ACTIVITY_DIRECTION_LABEL } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { CrmActivity, CompanyContact } from "@/lib/types/database";

type Opt = { id: string; label: string };

export function ActivitiesTab({
  companyId,
  opportunityId,
  activities,
  contacts,
}: {
  companyId: string;
  opportunityId?: string;
  activities: CrmActivity[];
  contacts: Pick<CompanyContact, "id" | "first_name" | "last_name">[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createActivity(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    if (!confirm("حذف این فعالیت؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("company_id", companyId);
    startTransition(async () => {
      await deleteActivity(null, fd);
      router.refresh();
    });
  }

  const contactOpts: Opt[] = contacts.map((c) => ({ id: c.id, label: `${c.first_name} ${c.last_name ?? ""}`.trim() }));

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">فعالیت‌ها</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> فعالیت جدید
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
          <input type="hidden" name="company_id" value={companyId} />
          {opportunityId && <input type="hidden" name="opportunity_id" value={opportunityId} />}
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نوع فعالیت">
              <select name="activity_type" className="input" defaultValue="NOTE">
                {CRM_ACTIVITY_TYPE.map((t) => (<option key={t} value={t}>{CRM_ACTIVITY_TYPE_LABEL[t]}</option>))}
              </select>
            </Field>
            <Field label="جهت">
              <select name="direction" className="input" defaultValue="INTERNAL">
                {(Object.keys(CRM_ACTIVITY_DIRECTION_LABEL) as (keyof typeof CRM_ACTIVITY_DIRECTION_LABEL)[]).map((d) => (
                  <option key={d} value={d}>{CRM_ACTIVITY_DIRECTION_LABEL[d]}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="موضوع" required><input name="subject" required className="input" /></Field>
          {contactOpts.length > 0 && (
            <Field label="فرد رابط">
              <select name="contact_id" className="input" defaultValue="">
                <option value="">—</option>
                {contactOpts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
          )}
          <Field label="شرح"><textarea name="summary" rows={2} className="input" /></Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ثبت"}</button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setAdding(false)}>انصراف</button>
          </div>
        </form>
      )}

      {activities.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز فعالیتی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {activities.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5">
              <div className="flex-1">
                <p className="text-sm text-ink">
                  <span className="text-ink-muted">{CRM_ACTIVITY_TYPE_LABEL[a.activity_type]}</span> — {a.subject}
                </p>
                {a.summary && <p className="mt-0.5 text-xs text-ink-muted">{a.summary}</p>}
                <p className="mt-0.5 text-xs text-ink-muted tnum">{formatJalali(a.activity_date)}</p>
              </div>
              <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(a.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

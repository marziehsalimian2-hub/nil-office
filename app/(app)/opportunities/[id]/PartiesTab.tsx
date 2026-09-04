"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { addParty, removeParty } from "@/app/actions/crm-parties";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { CRM_OPPORTUNITY_PARTY_ROLE, CRM_OPPORTUNITY_PARTY_ROLE_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };
type PartyRow = {
  id: string;
  company_id: string;
  companyName: string;
  contact_id: string | null;
  contactName: string | null;
  role: string;
  notes: string | null;
};

export function PartiesTab({
  opportunityId,
  companies,
  contacts,
  parties,
}: {
  opportunityId: string;
  companies: Opt[];
  contacts: (Opt & { company_id: string })[];
  parties: PartyRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addParty(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setAdding(false);
        setCompanyId("");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    if (!confirm("حذف این طرف معامله؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("opportunity_id", opportunityId);
    startTransition(async () => {
      await removeParty(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">طرف‌های معامله</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> افزودن طرف
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="شرکت" required>
              <select name="company_id" required className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">— انتخاب —</option>
                {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
            <Field label="نقش" required>
              <select name="role" required className="input" defaultValue="">
                <option value="" disabled>— انتخاب —</option>
                {CRM_OPPORTUNITY_PARTY_ROLE.map((r) => (<option key={r} value={r}>{CRM_OPPORTUNITY_PARTY_ROLE_LABEL[r]}</option>))}
              </select>
            </Field>
          </div>
          <Field label="فرد رابط">
            <select name="contact_id" className="input" defaultValue="">
              <option value="">—</option>
              {contacts.filter((c) => c.company_id === companyId).map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="یادداشت"><textarea name="notes" rows={2} className="input" /></Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "افزودن"}</button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setAdding(false)}>انصراف</button>
          </div>
        </form>
      )}

      {parties.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز طرف معامله‌ای ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {parties.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1">
                <p className="text-sm text-ink">
                  <span className="text-ink-muted">{CRM_OPPORTUNITY_PARTY_ROLE_LABEL[p.role as keyof typeof CRM_OPPORTUNITY_PARTY_ROLE_LABEL] ?? p.role}</span> — {p.companyName}
                </p>
                {p.contactName && <p className="text-xs text-ink-muted">{p.contactName}</p>}
              </div>
              <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(p.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Trash2, Pencil } from "lucide-react";
import { createContact, updateContact, deleteContact } from "@/app/actions/crm-contacts";
import { checkSimilarContacts, type SimilarContact } from "@/app/actions/crm-duplicates";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { CRM_CONTACT_ROLE, CRM_CONTACT_ROLE_LABEL } from "@/lib/enums";
import type { CompanyContact } from "@/lib/types/database";

function ContactForm({
  companyId,
  contact,
  onDone,
}: {
  companyId: string;
  contact?: CompanyContact;
  onDone: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(contact?.email ?? "");
  const [mobile, setMobile] = useState(contact?.mobile ?? "");
  const [similar, setSimilar] = useState<SimilarContact[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (contact) return; // no duplicate check while editing an existing contact
    if (timer.current) clearTimeout(timer.current);
    if (!email.trim() && !mobile.trim()) {
      setSimilar([]);
      return;
    }
    timer.current = setTimeout(() => {
      checkSimilarContacts(companyId, email, mobile).then(setSimilar);
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [email, mobile, companyId, contact]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = contact ? await updateContact(null, fd) : await createContact(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
      <input type="hidden" name="company_id" value={companyId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نام" required><input name="first_name" required defaultValue={contact?.first_name ?? ""} className="input" /></Field>
        <Field label="نام خانوادگی"><input name="last_name" defaultValue={contact?.last_name ?? ""} className="input" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="سمت"><input name="job_title" defaultValue={contact?.job_title ?? ""} className="input" /></Field>
        <Field label="نقش">
          <select name="contact_role" className="input" defaultValue={contact?.contact_role ?? ""}>
            <option value="">—</option>
            {CRM_CONTACT_ROLE.map((r) => (<option key={r} value={r}>{CRM_CONTACT_ROLE_LABEL[r]}</option>))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="ایمیل"><input name="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="input text-left" /></Field>
        <Field label="تلفن"><input name="phone" dir="ltr" defaultValue={contact?.phone ?? ""} className="input text-left" /></Field>
        <Field label="موبایل"><input name="mobile" dir="ltr" value={mobile} onChange={(e) => setMobile(e.target.value)} className="input text-left" /></Field>
      </div>
      <DuplicateWarning
        items={similar.map((c) => ({ id: c.id, label: `${c.first_name} ${c.last_name ?? ""}`.trim(), sublabel: c.email ?? c.mobile }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="واتساپ"><input name="whatsapp" dir="ltr" defaultValue={contact?.whatsapp ?? ""} className="input text-left" /></Field>
        <Field label="تلگرام"><input name="telegram" dir="ltr" defaultValue={contact?.telegram ?? ""} className="input text-left" /></Field>
        <Field label="کشور"><input name="country" defaultValue={contact?.country ?? ""} className="input" /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" name="is_primary" value="true" defaultChecked={contact?.is_primary ?? false} /> رابط اصلی
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" name="is_decision_maker" value="true" defaultChecked={contact?.is_decision_maker ?? false} /> تصمیم‌گیرنده
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" name="is_active" value="true" defaultChecked={contact?.is_active ?? true} /> فعال
        </label>
      </div>
      <Field label="یادداشت"><textarea name="notes" rows={2} defaultValue={contact?.notes ?? ""} className="input" /></Field>
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
        <button type="button" disabled={pending} className="btn-quiet" onClick={onDone}>انصراف</button>
      </div>
    </form>
  );
}

export function ContactsTab({ companyId, contacts }: { companyId: string; contacts: CompanyContact[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("حذف این رابط؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("company_id", companyId);
    startTransition(async () => {
      await deleteContact(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">افراد رابط</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> رابط جدید
          </button>
        )}
      </div>
      {adding && <div className="mb-4"><ContactForm companyId={companyId} onDone={() => setAdding(false)} /></div>}
      {contacts.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز رابطی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {contacts.map((c) =>
            editingId === c.id ? (
              <li key={c.id} className="py-3">
                <ContactForm companyId={companyId} contact={c} onDone={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-sm text-ink">
                    {c.is_primary && <Star className="h-3.5 w-3.5 text-seal" />}
                    {c.first_name} {c.last_name}
                    {c.job_title && <span className="text-ink-muted"> — {c.job_title}</span>}
                  </p>
                  <p className="text-xs text-ink-muted" dir="ltr">
                    {[c.email, c.mobile || c.phone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button type="button" className="btn-quiet p-1.5" aria-label="ویرایش" onClick={() => setEditingId(c.id)}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(c.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

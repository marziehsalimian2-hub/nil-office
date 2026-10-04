"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { upsertLegalRuleEntry, deleteLegalRuleEntry } from "@/app/actions/payroll-rules";
import { Field, FormError } from "@/components/form";
import { SUGGESTED_RULE_KEYS } from "@/lib/enums";
import type { LegalRuleEntry } from "@/lib/types/database";

const jsonText = (v: unknown) => (v == null ? "" : JSON.stringify(v, null, 2));

/** Entries table + editor. Editing controls only render while the set is DRAFT (parent decides `editable`); the DB enforces it regardless. */
export function RuleEntryEditor({ ruleSetId, entries, editable }: { ruleSetId: string; entries: LegalRuleEntry[]; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<LegalRuleEntry | null>(null);
  const [formKey, setFormKey] = useState(0);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("rule_set_id", ruleSetId);
    start(async () => {
      const r = await upsertLegalRuleEntry(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(undefined);
        setEditing(null);
        setFormKey((k) => k + 1);
        router.refresh();
      }
    });
  }
  function remove(entryId: string) {
    if (!confirm("این قاعده حذف شود؟")) return;
    const fd = new FormData();
    fd.set("entry_id", entryId);
    fd.set("rule_set_id", ruleSetId);
    start(async () => {
      const r = await deleteLegalRuleEntry(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز قاعده‌ای ثبت نشده است.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="table-head">
                <th className="px-3 py-2">کلید</th><th className="px-3 py-2">مقدار</th><th className="px-3 py-2">واحد</th>
                <th className="px-3 py-2">شرح</th><th className="px-3 py-2">منبع</th>{editable && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((en) => (
                <tr key={en.id} className="table-row align-top">
                  <td className="px-3 py-2 text-ink" dir="ltr">{en.rule_key}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {en.value_numeric != null && <span className="tnum" dir="ltr">{en.value_numeric}</span>}
                    {en.value_json != null && <pre className="mt-1 max-w-xs overflow-x-auto text-xs" dir="ltr">{jsonText(en.value_json)}</pre>}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{en.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{en.description ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{en.source_reference ?? "—"}</td>
                  {editable && (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button type="button" disabled={pending} className="btn-quiet p-1.5" aria-label="ویرایش" onClick={() => { setEditing(en); setFormKey((k) => k + 1); }}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(en.id)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable ? (
        <form key={formKey} onSubmit={submit} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <p className="text-xs font-medium text-ink-muted">{editing ? `ویرایش قاعدهٔ «${editing.rule_key}»` : "افزودن قاعده"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="کلید قاعده" required>
              <input name="rule_key" required dir="ltr" list="rule-key-suggestions-entry" readOnly={!!editing} className="input" defaultValue={editing?.rule_key ?? ""} />
              <datalist id="rule-key-suggestions-entry">
                {SUGGESTED_RULE_KEYS.map((k) => (<option key={k.key} value={k.key}>{k.label_fa}</option>))}
              </datalist>
            </Field>
            <Field label="مقدار عددی"><input name="value_numeric" dir="ltr" inputMode="decimal" className="input tnum" defaultValue={editing?.value_numeric != null ? String(editing.value_numeric) : ""} /></Field>
            <Field label="واحد"><input name="unit" className="input" defaultValue={editing?.unit ?? ""} /></Field>
          </div>
          <Field label="مقدار ساختاریافته (JSON) — فقط داده، هرگز اجرا نمی‌شود" hint="مثلاً پله‌های مالیات؛ حداقل یکی از مقدار عددی یا JSON لازم است">
            <textarea name="value_json" rows={3} dir="ltr" className="input font-mono text-xs" defaultValue={jsonText(editing?.value_json)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="شرح"><input name="description" className="input" defaultValue={editing?.description ?? ""} /></Field>
            <Field label="منبع این قاعده"><input name="source_reference" className="input" defaultValue={editing?.source_reference ?? ""} /></Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-xs">{pending ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییر" : "افزودن قاعده"}</button>
            {editing && <button type="button" className="btn-quiet !py-1.5 text-xs" onClick={() => { setEditing(null); setFormKey((k) => k + 1); }}>انصراف</button>}
          </div>
        </form>
      ) : (
        <p className="text-xs text-ink-muted">این مجموعه دیگر پیش‌نویس نیست؛ قواعد آن قفل شده‌اند. برای اصلاح، نسخهٔ جدید بسازید.</p>
      )}
    </div>
  );
}

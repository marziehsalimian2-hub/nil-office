"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { updateOutgoing } from "@/app/actions/correspondence";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Card } from "@/components/ui";
import { LANGUAGE, LANGUAGE_LABEL, PRIORITY, PRIORITY_LABEL } from "@/lib/enums";
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

export function EditableLetterCard({
  id,
  direction,
  canEdit,
  companies,
  cases,
  profiles,
  view,
  initial,
}: {
  id: string;
  direction: "OUTGOING" | "INCOMING";
  canEdit: boolean;
  companies: Opt[];
  cases: Opt[];
  profiles: Opt[];
  view: {
    subject: string | null;
    counterparty: string | null;
    priority: keyof typeof PRIORITY_LABEL;
    language: keyof typeof LANGUAGE_LABEL;
    relatedCase: { id: string; label: string } | null;
    requiresResponse: boolean;
    followupDate: string | null;
    sentReceivedMethod: string | null;
    createdAt: string;
    finalizedAt: string | null;
    externalLetterNumber: string | null;
    externalLetterDate: string | null;
    draftHtml: string | null;
    internalNotes: string | null;
  };
  initial: {
    recipient_company_id: string | null;
    recipient_name: string | null;
    case_id: string | null;
    signatory_id: string | null;
    signatory_label: string | null;
    draft_text: string | null;
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
      const res = await updateOutgoing(null, formData);
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

          <Field label="موضوع نامه" required>
            <input name="subject" required defaultValue={view.subject ?? ""} className="input" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="شرکت گیرنده">
              <select name="recipient_company_id" className="input" defaultValue={initial.recipient_company_id ?? ""}>
                <option value="">— انتخاب شرکت —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="نام شخص / سمت گیرنده">
              <input name="recipient_name" className="input" defaultValue={initial.recipient_name ?? ""} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="پرونده مرتبط">
              <select name="case_id" className="input" defaultValue={initial.case_id ?? ""}>
                <option value="">— بدون پرونده —</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="امضاکننده">
              <select name="signatory_id" className="input" defaultValue={initial.signatory_id ?? ""}>
                <option value="">— انتخاب امضاکننده —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="نام/سمت زیر امضا" hint="اختیاری — هر خط جدا زیر امضا و مهر چاپ می‌شود؛ برای خط بعدی Enter بزنید">
            <textarea name="signatory_label" rows={2} className="input" defaultValue={initial.signatory_label ?? ""} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="زبان">
              <select name="language" className="input" defaultValue={view.language}>
                {LANGUAGE.map((l) => (
                  <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>
                ))}
              </select>
            </Field>
            <Field label="اولویت">
              <select name="priority" className="input" defaultValue={view.priority}>
                {PRIORITY.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </Field>
            <Field label="روش ارسال">
              <input name="sent_received_method" className="input" defaultValue={view.sentReceivedMethod ?? ""} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                name="requires_response"
                value="true"
                defaultChecked={view.requiresResponse}
                className="h-4 w-4 accent-[#9a6a2e]"
              />
              <span className="text-sm text-ink">این نامه نیاز به پاسخ دارد</span>
            </label>
            <Field label="تاریخ پیگیری" hint="در صورت نیاز به پاسخ">
              <JalaliDateInput name="followup_date" defaultISO={view.followupDate} />
            </Field>
          </div>

          <Field label="متن نامه" hint="با «دانلود PDF» در صفحهٔ نامه روی سربرگ رسمی نمایش داده می‌شود">
            <RichTextEditor name="draft_text" defaultHTML={initial.draft_text} />
          </Field>

          <Field label="یادداشت داخلی">
            <textarea
              name="internal_notes"
              rows={2}
              className="input"
              defaultValue={view.internalNotes ?? ""}
              placeholder="یادداشت داخلی (در نامه چاپ نمی‌شود)"
            />
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
    <>
      <Card>
        <div className="mb-1 flex items-start justify-between">
          <p className="text-sm font-medium text-ink">اطلاعات نامه</p>
          {canEdit && (
            <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> ویرایش
            </button>
          )}
        </div>
        <Row label="موضوع">{view.subject || "—"}</Row>
        <Row label={direction === "OUTGOING" ? "گیرنده" : "فرستنده"}>{view.counterparty || "—"}</Row>
        <Row label="اولویت">{PRIORITY_LABEL[view.priority]}</Row>
        <Row label="زبان">{LANGUAGE_LABEL[view.language]}</Row>
        <Row label="پرونده">
          {view.relatedCase ? (
            <Link href={`/cases/${view.relatedCase.id}`} className="text-seal hover:underline">
              {view.relatedCase.label}
            </Link>
          ) : (
            "—"
          )}
        </Row>
        {direction === "INCOMING" && (
          <>
            <Row label="شمارهٔ نامهٔ فرستنده">{view.externalLetterNumber || "—"}</Row>
            <Row label="تاریخ نامهٔ فرستنده">{formatJalali(view.externalLetterDate)}</Row>
          </>
        )}
        <Row label="نیاز به پاسخ">{view.requiresResponse ? "بله" : "خیر"}</Row>
        <Row label="تاریخ پیگیری">{formatJalali(view.followupDate)}</Row>
        <Row label="روش ارسال/دریافت">{view.sentReceivedMethod || "—"}</Row>
        <Row label="تاریخ ثبت">{formatJalali(view.createdAt)}</Row>
        {view.finalizedAt && <Row label="تاریخ ثبت نهایی">{formatJalali(view.finalizedAt)}</Row>}
      </Card>

      {view.draftHtml && (
        <Card>
          <p className="mb-2 text-sm font-medium text-ink">متن نامه</p>
          <div
            dir="rtl"
            className="text-sm leading-7 text-ink [&_ol]:mr-5 [&_ol]:list-decimal [&_ul]:mr-5 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: view.draftHtml }}
          />
        </Card>
      )}

      {view.internalNotes && (
        <Card className="bg-seal-tint/40">
          <p className="mb-1 text-sm font-medium text-ink">یادداشت داخلی</p>
          <p className="whitespace-pre-wrap text-sm text-ink-muted">{view.internalNotes}</p>
        </Card>
      )}
    </>
  );
}

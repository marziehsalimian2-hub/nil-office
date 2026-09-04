"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { createQuotation, updateQuotation, deleteQuotation } from "@/app/actions/crm-quotations";
import { Field, FormError } from "@/components/form";
import { MoneyInput } from "@/components/MoneyInput";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { Card } from "@/components/ui";
import { CRM_QUOTATION_DIRECTION_LABEL, CURRENCY } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import type { CrmQuotation } from "@/lib/types/database";

type Opt = { id: string; label: string };

function QuotationForm({
  opportunityId,
  companies,
  quotation,
  onDone,
}: {
  opportunityId: string;
  companies: Opt[];
  quotation?: CrmQuotation;
  onDone: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = quotation ? await updateQuotation(null, fd) : await createQuotation(null, fd);
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
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      {quotation && <input type="hidden" name="id" value={quotation.id} />}
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="جهت">
          <select name="direction" className="input" defaultValue={quotation?.direction ?? "SENT"}>
            {(Object.keys(CRM_QUOTATION_DIRECTION_LABEL) as (keyof typeof CRM_QUOTATION_DIRECTION_LABEL)[]).map((d) => (
              <option key={d} value={d}>{CRM_QUOTATION_DIRECTION_LABEL[d]}</option>
            ))}
          </select>
        </Field>
        <Field label="نام محصول"><input name="product_name" defaultValue={quotation?.product_name ?? ""} className="input" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="خریدار">
          <select name="buyer_company_id" className="input" defaultValue={quotation?.buyer_company_id ?? ""}>
            <option value="">—</option>
            {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </Field>
        <Field label="فروشنده">
          <select name="seller_company_id" className="input" defaultValue={quotation?.seller_company_id ?? ""}>
            <option value="">—</option>
            {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="مقدار"><input name="quantity" type="number" step="any" defaultValue={quotation?.quantity ?? ""} className="input tnum" dir="ltr" /></Field>
        <Field label="واحد"><input name="unit" defaultValue={quotation?.unit ?? ""} className="input" /></Field>
        <Field label="قیمت واحد"><MoneyInput name="unit_price" defaultValue={quotation?.unit_price != null ? String(quotation.unit_price) : ""} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="واحد پول">
          <select name="currency_code" className="input" defaultValue={quotation?.currency_code ?? ""}>
            <option value="">—</option>
            {CURRENCY.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </Field>
        <Field label="اینکوترمز"><input name="incoterm" dir="ltr" defaultValue={quotation?.incoterm ?? ""} className="input text-left" /></Field>
        <Field label="تاریخ اعتبار"><JalaliDateInput name="validity_date" defaultISO={quotation?.validity_date} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="مبدأ"><input name="origin_country" defaultValue={quotation?.origin_country ?? ""} className="input" /></Field>
        <Field label="مقصد"><input name="destination_country" defaultValue={quotation?.destination_country ?? ""} className="input" /></Field>
      </div>
      <Field label="شرایط پرداخت"><input name="payment_terms" defaultValue={quotation?.payment_terms ?? ""} className="input" /></Field>
      <Field label="یادداشت"><textarea name="notes" rows={2} defaultValue={quotation?.notes ?? ""} className="input" /></Field>
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
        <button type="button" disabled={pending} className="btn-quiet" onClick={onDone}>انصراف</button>
      </div>
    </form>
  );
}

export function QuotationsTab({
  opportunityId,
  companies,
  quotations,
}: {
  opportunityId: string;
  companies: Opt[];
  quotations: CrmQuotation[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("حذف این پیشنهاد؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("opportunity_id", opportunityId);
    startTransition(async () => {
      await deleteQuotation(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">پیشنهادهای قیمت</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> پیشنهاد جدید
          </button>
        )}
      </div>

      {adding && <div className="mb-4"><QuotationForm opportunityId={opportunityId} companies={companies} onDone={() => setAdding(false)} /></div>}

      {quotations.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز پیشنهادی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {quotations.map((q) =>
            editingId === q.id ? (
              <li key={q.id} className="py-3">
                <QuotationForm opportunityId={opportunityId} companies={companies} quotation={q} onDone={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={q.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="text-sm text-ink">
                    <span className="text-ink-muted">{CRM_QUOTATION_DIRECTION_LABEL[q.direction]}</span> — {q.product_name || "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted tnum">
                    {q.quantity != null ? `${q.quantity} ${q.unit ?? ""} × ` : ""}
                    {q.unit_price != null ? `${formatMoney(q.unit_price)} ${q.currency_code ?? ""}` : ""}
                    {q.validity_date ? ` · تا ${formatJalali(q.validity_date)}` : ""}
                  </p>
                </div>
                <button type="button" className="btn-quiet p-1.5" aria-label="ویرایش" onClick={() => setEditingId(q.id)}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(q.id)}>
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { upsertTradeDetails } from "@/app/actions/crm-trade";
import { Field, FormError } from "@/components/form";
import { MoneyInput } from "@/components/MoneyInput";
import { Card } from "@/components/ui";
import { CRM_TRADE_FREQUENCY, CRM_TRADE_FREQUENCY_LABEL, CURRENCY } from "@/lib/enums";
import type { CrmOpportunityTradeDetails } from "@/lib/types/database";

type Opt = { id: string; label: string };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export function TradeDetailsCard({
  opportunityId,
  companies,
  contacts,
  details,
}: {
  opportunityId: string;
  companies: Opt[];
  contacts: (Opt & { company_id: string })[];
  details: CrmOpportunityTradeDetails | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!details);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [buyerId, setBuyerId] = useState(details?.buyer_company_id ?? "");
  const [sellerId, setSellerId] = useState(details?.seller_company_id ?? "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await upsertTradeDetails(null, fd);
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
        <input type="hidden" name="opportunity_id" value={opportunityId} />
        <Card className="space-y-4">
          <p className="text-sm font-medium text-ink">جزئیات معامله</p>
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام محصول"><input name="product_name" defaultValue={details?.product_name ?? ""} className="input" /></Field>
            <Field label="مشخصات/گرید"><input name="grade_specification" defaultValue={details?.grade_specification ?? ""} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="مبدأ"><input name="origin_country" defaultValue={details?.origin_country ?? ""} className="input" /></Field>
            <Field label="مقصد"><input name="destination_country" defaultValue={details?.destination_country ?? ""} className="input" /></Field>
            <Field label="بندر/محل تحویل مقصد"><input name="destination_port" defaultValue={details?.destination_port ?? ""} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="مقدار"><input name="quantity" type="number" step="any" defaultValue={details?.quantity ?? ""} className="input tnum" dir="ltr" /></Field>
            <Field label="واحد"><input name="unit" defaultValue={details?.unit ?? ""} className="input" /></Field>
            <Field label="بسته‌بندی"><input name="packaging" defaultValue={details?.packaging ?? ""} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اینکوترمز"><input name="incoterm" dir="ltr" defaultValue={details?.incoterm ?? ""} className="input text-left" /></Field>
            <Field label="شرایط تحویل"><input name="delivery_terms" defaultValue={details?.delivery_terms ?? ""} className="input" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="قیمت هدف"><MoneyInput name="target_price" defaultValue={details?.target_price != null ? String(details.target_price) : ""} /></Field>
            <Field label="قیمت پیشنهادی"><MoneyInput name="offered_price" defaultValue={details?.offered_price != null ? String(details.offered_price) : ""} /></Field>
            <Field label="واحد پول">
              <select name="currency_code" className="input" defaultValue={details?.currency_code ?? ""}>
                <option value="">—</option>
                {CURRENCY.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </Field>
          </div>
          <Field label="شرایط پرداخت"><input name="payment_terms" defaultValue={details?.payment_terms ?? ""} className="input" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="خریدار">
              <select name="buyer_company_id" className="input" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                <option value="">—</option>
                {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
            <Field label="فرد رابط خریدار">
              <select name="buyer_contact_id" className="input" defaultValue={details?.buyer_contact_id ?? ""}>
                <option value="">—</option>
                {contacts.filter((c) => c.company_id === buyerId).map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="فروشنده">
              <select name="seller_company_id" className="input" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                <option value="">—</option>
                {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
            <Field label="فرد رابط فروشنده">
              <select name="seller_contact_id" className="input" defaultValue={details?.seller_contact_id ?? ""}>
                <option value="">—</option>
                {contacts.filter((c) => c.company_id === sellerId).map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
          </div>
          <Field label="تناوب معامله">
            <select name="monthly_or_one_time" className="input" defaultValue={details?.monthly_or_one_time ?? ""}>
              <option value="">—</option>
              {CRM_TRADE_FREQUENCY.map((f) => (<option key={f} value={f}>{CRM_TRADE_FREQUENCY_LABEL[f]}</option>))}
            </select>
          </Field>
          <Field label="یادداشت مشخصات فنی"><textarea name="specification_notes" rows={2} defaultValue={details?.specification_notes ?? ""} className="input" /></Field>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
            {details && <button type="button" disabled={pending} className="btn-quiet" onClick={() => setEditing(false)}>انصراف</button>}
          </div>
        </Card>
      </form>
    );
  }

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between">
        <p className="text-sm font-medium text-ink">جزئیات معامله</p>
        <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" /> ویرایش
        </button>
      </div>
      <Row label="محصول">{details!.product_name || "—"}</Row>
      <Row label="مشخصات/گرید">{details!.grade_specification || "—"}</Row>
      <Row label="مبدأ ← مقصد">{details!.origin_country || "—"} ← {details!.destination_country || "—"}</Row>
      <Row label="مقدار">{details!.quantity != null ? `${details!.quantity} ${details!.unit ?? ""}` : "—"}</Row>
      <Row label="اینکوترمز"><span dir="ltr">{details!.incoterm || "—"}</span></Row>
      <Row label="قیمت پیشنهادی">{details!.offered_price != null ? `${details!.offered_price} ${details!.currency_code ?? ""}` : "—"}</Row>
      <Row label="شرایط پرداخت">{details!.payment_terms || "—"}</Row>
      <Row label="تناوب">{details!.monthly_or_one_time ? CRM_TRADE_FREQUENCY_LABEL[details!.monthly_or_one_time] : "—"}</Row>
    </Card>
  );
}

"use client";

import { useActionState } from "react";
import { createTradeOfferDraft, updateTradeOfferDraft, type ActionState } from "@/app/actions/trade";
import { Field, FormError, SubmitButton } from "@/components/form";
import { CURRENCY, CURRENCY_LABEL } from "@/lib/enums";

export function TradeOfferForm({
  offerId,
  initial,
}: {
  offerId?: string;
  initial?: {
    title: string;
    product_name: string;
    product_type: string | null;
    quantity: string;
    unit: string;
    price: string;
    currency_code: string;
    price_basis: string;
    origin: string | null;
    delivery_location: string | null;
    delivery_terms: string | null;
    payment_terms: string | null;
    description: string | null;
    terms_and_conditions: string | null;
    interest_deadline: string;
    document_deadline: string;
    timezone: string;
  };
}) {
  const action = offerId ? updateTradeOfferDraft : createTradeOfferDraft;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  // datetime-local wants "YYYY-MM-DDTHH:mm" with no seconds/offset.
  const toLocalInput = (iso?: string) => (iso ? iso.slice(0, 16) : "");

  return (
    <form action={formAction} className="space-y-5">
      {offerId && <input type="hidden" name="id" value={offerId} />}
      <FormError message={state?.error} />

      <div className="card space-y-4 p-5">
        <Field label="عنوان آفر" required>
          <input name="title" required defaultValue={initial?.title ?? ""} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام محصول" required>
            <input name="product_name" required defaultValue={initial?.product_name ?? ""} className="input" />
          </Field>
          <Field label="نوع/دستهٔ محصول">
            <input name="product_type" defaultValue={initial?.product_type ?? ""} className="input" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="مقدار" required>
            <input name="quantity" type="number" step="any" min="0" required defaultValue={initial?.quantity ?? ""} className="input" />
          </Field>
          <Field label="واحد" required hint="مثلاً MT، تن، عدد">
            <input name="unit" required defaultValue={initial?.unit ?? ""} className="input" />
          </Field>
          <Field label="مبنای قیمت (اینکوترمز)" required hint="مثلاً FOB، CFR، CIF، EXW">
            <input name="price_basis" required defaultValue={initial?.price_basis ?? ""} className="input" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="قیمت واحد" required>
            <input name="price" type="number" step="any" min="0" required defaultValue={initial?.price ?? ""} className="input" />
          </Field>
          <Field label="واحد پول">
            <select name="currency_code" className="input" defaultValue={initial?.currency_code ?? "USD"}>
              {CURRENCY.map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مبدأ">
            <input name="origin" defaultValue={initial?.origin ?? ""} className="input" />
          </Field>
          <Field label="محل تحویل">
            <input name="delivery_location" defaultValue={initial?.delivery_location ?? ""} className="input" />
          </Field>
        </div>

        <Field label="شرایط تحویل">
          <textarea name="delivery_terms" rows={2} defaultValue={initial?.delivery_terms ?? ""} className="input" />
        </Field>
        <Field label="شرایط پرداخت">
          <textarea name="payment_terms" rows={2} defaultValue={initial?.payment_terms ?? ""} className="input" />
        </Field>
        <Field label="توضیحات" hint="برای خریدار نمایش داده می‌شود">
          <textarea name="description" rows={3} defaultValue={initial?.description ?? ""} className="input" />
        </Field>
        <Field label="شرایط و ضوابط" hint="برای خریدار نمایش داده می‌شود">
          <textarea name="terms_and_conditions" rows={3} defaultValue={initial?.terms_and_conditions ?? ""} className="input" />
        </Field>
      </div>

      <div className="card space-y-4 p-5">
        <p className="text-sm font-medium text-ink">مهلت‌ها</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مهلت اعلام تمایل" required hint="خریدار تا این زمان می‌تواند علاقه‌مندی خود را ثبت کند">
            <input
              name="interest_deadline"
              type="datetime-local"
              required
              defaultValue={toLocalInput(initial?.interest_deadline)}
              className="input"
              dir="ltr"
            />
          </Field>
          <Field label="مهلت ارسال LOI/ICPO" required hint="خریدار تا این زمان می‌تواند مدارک بارگذاری کند">
            <input
              name="document_deadline"
              type="datetime-local"
              required
              defaultValue={toLocalInput(initial?.document_deadline)}
              className="input"
              dir="ltr"
            />
          </Field>
        </div>
        <Field label="منطقهٔ زمانی" hint="در نسخهٔ آزمایشی فقط Asia/Tehran به‌درستی پشتیبانی می‌شود">
          <input name="timezone" defaultValue={initial?.timezone ?? "Asia/Tehran"} className="input" dir="ltr" />
        </Field>
      </div>

      <div className="flex gap-2">
        <SubmitButton>{offerId ? "ذخیرهٔ تغییرات" : "ذخیرهٔ پیش‌نویس"}</SubmitButton>
      </div>
    </form>
  );
}

"use client";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { createSalesDocumentDraft, updateSalesDocumentDraft, type ActionState } from "@/app/actions/invoices";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { formatMoney } from "@/lib/money";
import {
  SALES_DOCUMENT_TYPE, SALES_DOCUMENT_TYPE_LABEL,
  SALES_DOCUMENT_ITEM_TYPE, SALES_DOCUMENT_ITEM_TYPE_LABEL,
  CURRENCY, CURRENCY_LABEL,
  type SalesDocumentType,
} from "@/lib/enums";

type Opt = { id: string; label: string };
type CompanyOpt = {
  id: string;
  legal_name: string;
  english_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};
type Line = {
  item_type: string; description: string; unit: string;
  quantity: string; unit_price: string; discount_amount: string; tax_amount: string;
};

const emptyLine = (): Line => ({ item_type: "SERVICE", description: "", unit: "", quantity: "1", unit_price: "", discount_amount: "", tax_amount: "" });

export function InvoiceForm({
  docId,
  defaultType = "PROFORMA",
  companies,
  contracts,
  cases,
  initial,
}: {
  docId?: string;
  defaultType?: SalesDocumentType;
  companies: CompanyOpt[];
  contracts: Opt[];
  cases: Opt[];
  initial?: {
    type: SalesDocumentType;
    company_id: string | null;
    contract_id: string | null;
    case_id: string | null;
    issue_date: string | null;
    due_date: string | null;
    validity_date: string | null;
    currency_code: string;
    payment_terms: string | null;
    notes: string | null;
    customer_legal_name_snapshot: string;
    customer_english_name_snapshot: string | null;
    customer_registration_number_snapshot: string | null;
    customer_national_id_snapshot: string | null;
    customer_economic_code_snapshot: string | null;
    customer_address_snapshot: string | null;
    customer_postal_code_snapshot: string | null;
    customer_contact_person_snapshot: string | null;
    customer_email_snapshot: string | null;
    customer_phone_snapshot: string | null;
    items: Line[];
  };
}) {
  const action = docId ? updateSalesDocumentDraft : createSalesDocumentDraft;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  const [type, setType] = useState<SalesDocumentType>(initial?.type ?? defaultType);
  const [companyId, setCompanyId] = useState(initial?.company_id ?? "");
  const [legalName, setLegalName] = useState(initial?.customer_legal_name_snapshot ?? "");
  const [englishName, setEnglishName] = useState(initial?.customer_english_name_snapshot ?? "");
  const [contactPerson, setContactPerson] = useState(initial?.customer_contact_person_snapshot ?? "");
  const [email, setEmail] = useState(initial?.customer_email_snapshot ?? "");
  const [phone, setPhone] = useState(initial?.customer_phone_snapshot ?? "");
  const [address, setAddress] = useState(initial?.customer_address_snapshot ?? "");

  const [lines, setLines] = useState<Line[]>(initial?.items?.length ? initial.items : [emptyLine()]);

  function onCompanyChange(id: string) {
    setCompanyId(id);
    const c = companies.find((x) => x.id === id);
    if (c) {
      setLegalName(c.legal_name);
      setEnglishName(c.english_name ?? "");
      setContactPerson(c.contact_person ?? "");
      setEmail(c.email ?? "");
      setPhone(c.phone ?? "");
      setAddress(c.address ?? "");
    }
  }

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0;
    for (const l of lines) {
      const q = Number(l.quantity) || 0;
      const p = Number(l.unit_price) || 0;
      subtotal += q * p;
      discount += Number(l.discount_amount) || 0;
      tax += Number(l.tax_amount) || 0;
    }
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [lines]);

  const itemsPayload = useMemo(
    () =>
      JSON.stringify(
        lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            item_type: l.item_type,
            description: l.description,
            unit: l.unit || null,
            quantity: Number(l.quantity) || 0,
            unit_price: Number(l.unit_price) || 0,
            discount_amount: Number(l.discount_amount) || 0,
            tax_amount: Number(l.tax_amount) || 0,
          })),
      ),
    [lines],
  );

  const set = (i: number, k: keyof Line, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state?.error} />
      {docId && <input type="hidden" name="id" value={docId} />}
      <input type="hidden" name="items" value={itemsPayload} />
      <input type="hidden" name="customer_legal_name_snapshot" value={legalName} />
      <input type="hidden" name="customer_english_name_snapshot" value={englishName} />
      <input type="hidden" name="customer_contact_person_snapshot" value={contactPerson} />
      <input type="hidden" name="customer_email_snapshot" value={email} />
      <input type="hidden" name="customer_phone_snapshot" value={phone} />
      <input type="hidden" name="customer_address_snapshot" value={address} />

      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="نوع سند" required>
            <select
              name="type"
              required
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as SalesDocumentType)}
              disabled={!!docId}
            >
              {SALES_DOCUMENT_TYPE.map((t) => (
                <option key={t} value={t}>{SALES_DOCUMENT_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="طرف حساب (مشتری)" required>
            <select name="company_id" required className="input" value={companyId} onChange={(e) => onCompanyChange(e.target.value)}>
              <option value="" disabled>— انتخاب —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.legal_name}</option>))}
            </select>
          </Field>
          <Field label="واحد پول" required>
            <select name="currency_code" className="input" defaultValue={initial?.currency_code ?? "IRR"}>
              {CURRENCY.map((c) => (<option key={c} value={c}>{CURRENCY_LABEL[c]}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="قرارداد مرتبط">
            <select name="contract_id" className="input" defaultValue={initial?.contract_id ?? ""}>
              <option value="">—</option>
              {contracts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="پروندهٔ مرتبط">
            <select name="case_id" className="input" defaultValue={initial?.case_id ?? ""}>
              <option value="">—</option>
              {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="تاریخ صدور"><JalaliDateInput name="issue_date" defaultISO={initial?.issue_date} /></Field>
          {type === "INVOICE" ? (
            <Field label="سررسید پرداخت"><JalaliDateInput name="due_date" defaultISO={initial?.due_date} /></Field>
          ) : (
            <Field label="تاریخ اعتبار"><JalaliDateInput name="validity_date" defaultISO={initial?.validity_date} /></Field>
          )}
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <p className="text-sm font-medium text-ink">اطلاعات مشتری</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام حقوقی" required>
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} required className="input" />
          </Field>
          <Field label="نام لاتین">
            <input value={englishName} onChange={(e) => setEnglishName(e.target.value)} className="input" dir="ltr" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شماره ثبت"><input name="customer_registration_number_snapshot" defaultValue={initial?.customer_registration_number_snapshot ?? ""} className="input" dir="ltr" /></Field>
          <Field label="شناسه/کد ملی"><input name="customer_national_id_snapshot" defaultValue={initial?.customer_national_id_snapshot ?? ""} className="input" dir="ltr" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="کد اقتصادی"><input name="customer_economic_code_snapshot" defaultValue={initial?.customer_economic_code_snapshot ?? ""} className="input" dir="ltr" /></Field>
          <Field label="کد پستی"><input name="customer_postal_code_snapshot" defaultValue={initial?.customer_postal_code_snapshot ?? ""} className="input" dir="ltr" /></Field>
        </div>
        <Field label="نشانی">
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="input" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="نماینده/تماس">
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input" />
          </Field>
          <Field label="ایمیل">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" dir="ltr" />
          </Field>
          <Field label="تلفن">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" dir="ltr" />
          </Field>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="table-head">
              <th className="px-2 py-2 text-right">شرح</th>
              <th className="px-2 py-2 text-right">نوع</th>
              <th className="px-2 py-2 text-right">تعداد</th>
              <th className="px-2 py-2 text-right">واحد</th>
              <th className="px-2 py-2 text-right">قیمت واحد</th>
              <th className="px-2 py-2 text-right">تخفیف</th>
              <th className="px-2 py-2 text-right">مالیات</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-2 py-2"><input className="input !py-1.5" value={l.description} onChange={(e) => set(i, "description", e.target.value)} /></td>
                <td className="px-2 py-2">
                  <select className="input !py-1.5" value={l.item_type} onChange={(e) => set(i, "item_type", e.target.value)}>
                    {SALES_DOCUMENT_ITEM_TYPE.map((t) => (<option key={t} value={t}>{SALES_DOCUMENT_ITEM_TYPE_LABEL[t]}</option>))}
                  </select>
                </td>
                <td className="px-2 py-2"><input type="number" step="any" className="input !py-1.5 tnum" value={l.quantity} onChange={(e) => set(i, "quantity", e.target.value)} /></td>
                <td className="px-2 py-2"><input className="input !py-1.5" value={l.unit} onChange={(e) => set(i, "unit", e.target.value)} /></td>
                <td className="px-2 py-2"><MoneyInput className="!py-1.5" value={l.unit_price} onChange={(v) => set(i, "unit_price", v)} /></td>
                <td className="px-2 py-2"><MoneyInput className="!py-1.5" value={l.discount_amount} onChange={(v) => set(i, "discount_amount", v)} /></td>
                <td className="px-2 py-2"><MoneyInput className="!py-1.5" value={l.tax_amount} onChange={(v) => set(i, "tax_amount", v)} /></td>
                <td className="px-2 py-2 text-center">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="text-ink-muted hover:text-status-cancelled">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-paper/60">
              <td colSpan={7} className="px-3 py-2 text-left text-sm font-medium text-ink-muted">
                جمع جزء: <span className="tnum">{formatMoney(totals.subtotal)}</span> — تخفیف: <span className="tnum">{formatMoney(totals.discount)}</span> — مالیات: <span className="tnum">{formatMoney(totals.tax)}</span> — نهایی: <span className="tnum font-semibold text-seal">{formatMoney(totals.total)}</span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="btn-ghost">
        <Plus className="h-4 w-4" /> افزودن ردیف
      </button>

      <div className="card space-y-4 p-5">
        <Field label="شرایط پرداخت"><textarea name="payment_terms" rows={2} className="input" defaultValue={initial?.payment_terms ?? ""} /></Field>
        <Field label="یادداشت"><textarea name="notes" rows={2} className="input" defaultValue={initial?.notes ?? ""} /></Field>
      </div>

      <div className="flex gap-3">
        <SubmitButton variant="primary">{docId ? "ذخیرهٔ تغییرات" : "ثبت پیش‌نویس"}</SubmitButton>
        <Link href="/invoices" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}

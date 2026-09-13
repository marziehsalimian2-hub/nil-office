"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createChequeDraft, type ActionState } from "@/app/actions/cheques";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { amountToPersianWords } from "@/lib/cheque/amountToWords";
import { CHEQUE_CURRENCY_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };
type Direction = "PAYABLE" | "RECEIVABLE";

const CURRENCIES = Object.keys(CHEQUE_CURRENCY_LABEL);

export function ChequeForm({ books, companies, contracts }: { books: Opt[]; companies: Opt[]; contracts: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createChequeDraft, null);
  const [direction, setDirection] = useState<Direction>("PAYABLE");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("IRR");
  const [counterpartyCompany, setCounterpartyCompany] = useState("");

  const amountWords = useMemo(() => {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return null;
    try {
      return amountToPersianWords(Math.round(n), currency);
    } catch {
      return null;
    }
  }, [amount, currency]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <Field label="جهت چک" required>
          <div className="flex gap-4">
            {(["PAYABLE", "RECEIVABLE"] as Direction[]).map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="accent-[#9a6a2e]" />
                {d === "PAYABLE" ? "پرداختی (صادره توسط ما)" : "دریافتی (از شرکت دیگر)"}
              </label>
            ))}
          </div>
        </Field>

        {direction === "PAYABLE" ? (
          <Field label="دسته‌چک" required hint="فقط دسته‌چک‌های فعال نمایش داده می‌شوند">
            <select name="cheque_book_id" required className="input" defaultValue="">
              <option value="" disabled>
                — انتخاب —
              </option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="بانک صادرکننده" required>
              <input name="drawer_bank_name" required className="input" />
            </Field>
            <Field label="شعبه">
              <input name="drawer_branch" className="input" />
            </Field>
            <Field label="شمارهٔ حساب صادرکننده">
              <input name="drawer_account_number" dir="ltr" className="input text-center tnum" />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شمارهٔ چک" required>
            <input name="cheque_number" required dir="ltr" className="input text-center tnum" />
          </Field>
          <Field label="شناسهٔ صیاد">
            <input name="sayad_id" dir="ltr" className="input text-center tnum" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={direction === "PAYABLE" ? "ذی‌نفع (شرکت)" : "صادرکننده (شرکت)"}>
            <select
              name="counterparty_company_id"
              className="input"
              value={counterpartyCompany}
              onChange={(e) => setCounterpartyCompany(e.target.value)}
            >
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="یا نام آزاد (در صورت نبودن در فهرست شرکت‌ها)">
            <input name="counterparty_name" className="input" disabled={!!counterpartyCompany} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="مبلغ" required>
            <MoneyInput name="amount" value={amount} onChange={setAmount} required />
          </Field>
          <Field label="واحد پول" required>
            <select name="currency_code" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {CHEQUE_CURRENCY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تاریخ چک" required>
            <JalaliDateInput name="cheque_date" required />
          </Field>
        </div>
        {amountWords && (
          <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink-muted">
            مبلغ به حروف: <span className="font-medium text-ink">{amountWords}</span>
          </p>
        )}

        <Field label="بابت" hint="روی چک چاپ می‌شود">
          <input name="purpose" className="input" />
        </Field>

        <Field label="قرارداد مرتبط">
          <select name="contract_id" className="input" defaultValue="">
            <option value="">—</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="توضیحات داخلی">
          <textarea name="description" rows={2} className="input" />
        </Field>
      </div>

      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت پیش‌نویس</SubmitButton>
        <Link href="/cheques" className="btn-quiet">
          انصراف
        </Link>
      </div>
    </form>
  );
}

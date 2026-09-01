"use client";
import { useActionState } from "react";
import Link from "next/link";
import { type ActionState } from "@/app/actions/accounting";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";

type Opt = { id: string; label: string };
export function CashDocForm({
  kind, action, banks, accounts, details, companies, cases, contracts, fiscalYears,
}: {
  kind: "receipt" | "payment";
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  banks: Opt[]; accounts: Opt[]; details: Opt[]; companies: Opt[]; cases: Opt[]; contracts: Opt[]; fiscalYears: Opt[];
}) {
  const [state, run] = useActionState<ActionState, FormData>(action, null);
  const isReceipt = kind === "receipt";
  return (
    <form action={run} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="سال مالی" required>
            <select name="fiscal_year_id" required className="input" defaultValue={fiscalYears[0]?.id ?? ""}>
              {fiscalYears.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
            </select>
          </Field>
          <Field label="تاریخ" required><JalaliDateInput name="date" required /></Field>
          <Field label={isReceipt ? "دریافت‌کننده از" : "پرداخت به"}><input name="counterparty" className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مبلغ" required><MoneyInput name="amount" required /></Field>
          <Field label="روش"><input name="method" className="input" placeholder="کارت‌به‌کارت، چک، نقدی…" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isReceipt ? "به حساب (بانک/صندوق)" : "از حساب (بانک/صندوق)"} required>
            <select name="bank_account_id" required className="input" defaultValue="">
              <option value="" disabled>— انتخاب —</option>
              {banks.map((b) => (<option key={b.id} value={b.id}>{b.label}</option>))}
            </select>
          </Field>
          <Field label={isReceipt ? "حساب طرف مقابل (بستانکار)" : "حساب طرف مقابل (بدهکار)"} required>
            <select name="counterpart_account_id" required className="input" defaultValue="">
              <option value="" disabled>— انتخاب —</option>
              {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تفصیلی">
            <select name="detail_account_id" className="input" defaultValue=""><option value="">—</option>
              {details.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
            </select>
          </Field>
          <Field label="شماره پیگیری / مرجع"><input name="reference" dir="ltr" className="input tnum" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="شرکت مرتبط">
            <select name="company_id" className="input" defaultValue=""><option value="">—</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <Field label="پرونده مرتبط">
            <select name="case_id" className="input" defaultValue=""><option value="">—</option>
              {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
        </div>
        <Field label="قرارداد مرتبط">
          <select name="contract_id" className="input" defaultValue=""><option value="">—</option>
            {contracts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </Field>
        <Field label="شرح"><input name="description" className="input" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">{isReceipt ? "ثبت دریافت" : "ثبت پرداخت"}</SubmitButton>
        <Link href={`/accounting/${isReceipt ? "receipts" : "payments"}`} className="btn-quiet">انصراف</Link>
      </div>
      <p className="text-xs text-ink-muted">پس از ثبت، سند به‌صورت پیش‌نویس ذخیره می‌شود؛ با «ثبت قطعی» سند حسابداری دوطرفهٔ آن ساخته می‌شود.</p>
    </form>
  );
}

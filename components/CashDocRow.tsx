"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateReceipt, updatePayment, setReceiptAllocations, setPaymentAllocations, type ActionState } from "@/app/actions/accounting";
import { PostDocButton } from "@/components/PostDocButton";
import { VerifyDocButton } from "@/components/VerifyDocButton";
import { AllocationEditor, type AllocationRow } from "@/components/AllocationEditor";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import { formatMoney, type DisplayUnit } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";

type Opt = { id: string; label: string };
type TargetOpt = { id: string; label: string; total_amount: number };
type Row = {
  id: string;
  date: string;
  counterparty: string | null;
  amount: number;
  description: string | null;
  status: PostingStatus;
  bank_account_id: string | null;
  counterpart_account_id: string | null;
  detail_account_id: string | null;
  method: string | null;
  reference: string | null;
  company_id: string | null;
  case_id: string | null;
  contract_id: string | null;
  fiscal_year_id: string | null;
  verified_at: string | null;
  display_number: string | null;
};

export function CashDocRow({
  kind,
  row,
  unit,
  banks,
  accounts,
  details,
  companies,
  cases,
  contracts,
  salesDocuments,
  allocations,
  fiscalYears,
}: {
  kind: "receipt" | "payment";
  row: Row;
  unit: DisplayUnit;
  banks: Opt[];
  accounts: Opt[];
  details: Opt[];
  companies: Opt[];
  cases: Opt[];
  contracts: TargetOpt[];
  salesDocuments: TargetOpt[];
  allocations: AllocationRow[];
  fiscalYears: Opt[];
}) {
  const router = useRouter();
  const isReceipt = kind === "receipt";
  const updateAction: (p: ActionState, f: FormData) => Promise<ActionState> = isReceipt ? updateReceipt : updatePayment;
  const setAllocationsAction: (p: ActionState, f: FormData) => Promise<ActionState> = isReceipt ? setReceiptAllocations : setPaymentAllocations;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [editAmount, setEditAmount] = useState(row.amount > 0 ? String(row.amount) : "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateAction(null, formData);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      const allocFd = new FormData();
      allocFd.set("id", row.id);
      allocFd.set("allocations", String(formData.get("allocations") ?? "[]"));
      const allocRes = await setAllocationsAction(null, allocFd);
      if (allocRes && "error" in allocRes && allocRes.error) {
        setError(allocRes.error);
        return;
      }
      setError(undefined);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <tr className="border-t border-line bg-paper/40">
        <td colSpan={6} className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="hidden" name="id" value={row.id} />
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="سال مالی" required>
                <select name="fiscal_year_id" required className="input" defaultValue={row.fiscal_year_id ?? ""}>
                  {fiscalYears.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
                </select>
              </Field>
              <Field label="تاریخ" required><JalaliDateInput name="date" required defaultISO={row.date} /></Field>
              <Field label={isReceipt ? "دریافت‌کننده از" : "پرداخت به"}>
                <input name="counterparty" className="input" defaultValue={row.counterparty ?? ""} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="مبلغ" required><MoneyInput name="amount" required value={editAmount} onChange={setEditAmount} /></Field>
              <Field label="روش"><input name="method" className="input" defaultValue={row.method ?? ""} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={isReceipt ? "به حساب (بانک/صندوق)" : "از حساب (بانک/صندوق)"} required>
                <select name="bank_account_id" required className="input" defaultValue={row.bank_account_id ?? ""}>
                  <option value="" disabled>— انتخاب —</option>
                  {banks.map((b) => (<option key={b.id} value={b.id}>{b.label}</option>))}
                </select>
              </Field>
              <Field label={isReceipt ? "حساب طرف مقابل (بستانکار)" : "حساب طرف مقابل (بدهکار)"} required>
                <select name="counterpart_account_id" required className="input" defaultValue={row.counterpart_account_id ?? ""}>
                  <option value="" disabled>— انتخاب —</option>
                  {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="تفصیلی">
                <select name="detail_account_id" className="input" defaultValue={row.detail_account_id ?? ""}>
                  <option value="">—</option>
                  {details.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
                </select>
              </Field>
              <Field label="شماره پیگیری / مرجع"><input name="reference" dir="ltr" className="input tnum" defaultValue={row.reference ?? ""} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="شرکت مرتبط">
                <select name="company_id" className="input" defaultValue={row.company_id ?? ""}>
                  <option value="">—</option>
                  {companies.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
              </Field>
              <Field label="پرونده مرتبط">
                <select name="case_id" className="input" defaultValue={row.case_id ?? ""}>
                  <option value="">—</option>
                  {cases.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
              </Field>
            </div>
            <Field label="قرارداد مرتبط">
              <select name="contract_id" className="input" defaultValue={row.contract_id ?? ""}>
                <option value="">—</option>
                {contracts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </Field>
            <Field label="شرح"><input name="description" className="input" defaultValue={row.description ?? ""} /></Field>
            <Field label="تخصیص مبلغ" hint="با ثبت قطعی، وضعیت اسناد هدف به‌طور خودکار به‌روزرسانی می‌شود">
              <AllocationEditor
                sourceAmount={Number(editAmount) || undefined}
                salesDocuments={salesDocuments}
                contracts={contracts}
                unit={unit}
                initial={allocations}
              />
            </Field>
            <div className="flex gap-3">
              <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-sm">{pending ? "در حال ذخیره…" : "ذخیره تغییرات"}</button>
              <button type="button" disabled={pending} className="btn-quiet !py-1.5 text-sm" onClick={() => setEditing(false)}>انصراف</button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="table-row cursor-default">
      <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(row.date)}</td>
      <td className="px-4 py-3 text-ink">{row.counterparty ?? "—"}</td>
      <td className="px-4 py-3 text-ink-muted">{row.description ?? "—"}</td>
      <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(row.amount, unit)}</td>
      <td className="px-4 py-3">
        <span className={`badge ${POSTING_STATUS_TONE[row.status]}`}>{POSTING_STATUS_LABEL[row.status]}</span>
        {row.display_number && <span className="mr-2 tnum text-xs text-ink-muted" dir="ltr">{row.display_number}</span>}
      </td>
      <td className="px-4 py-3">
        {row.status === "DRAFT" && (
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-quiet !py-1 text-xs" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> ویرایش
            </button>
            {row.verified_at ? <PostDocButton id={row.id} kind={kind} /> : <VerifyDocButton id={row.id} kind={kind} />}
          </div>
        )}
      </td>
    </tr>
  );
}

"use client";

import { useActionState } from "react";
import { savePayrollAccountingSettings, type ActionState } from "@/app/actions/payroll-approval";
import { Field, FormError, SubmitButton } from "@/components/form";
import type { AccountOption } from "@/lib/payroll/review";

export function AccountSelect({ name, accounts, defaultValue, disabled, allowEmpty }: {
  name: string; accounts: AccountOption[]; defaultValue: string; disabled?: boolean; allowEmpty?: boolean;
}) {
  return (
    <select name={name} className="input" defaultValue={defaultValue} disabled={disabled} required={!allowEmpty}>
      <option value="">— انتخاب حساب —</option>
      {accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
    </select>
  );
}

export function AccountingSettingsForm({
  accounts, baseSalary, netPayable, canEdit,
}: { accounts: AccountOption[]; baseSalary: string; netPayable: string; canEdit: boolean }) {
  const [state, run] = useActionState<ActionState, FormData>(savePayrollAccountingSettings, null);
  return (
    <form action={run} className="space-y-3">
      <FormError message={state?.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="هزینهٔ حقوق پایه (بدهکار)"><AccountSelect name="base_salary_expense" accounts={accounts} defaultValue={baseSalary} disabled={!canEdit} /></Field>
        <Field label="حقوق پرداختنی (بستانکار)"><AccountSelect name="net_payable" accounts={accounts} defaultValue={netPayable} disabled={!canEdit} /></Field>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <SubmitButton variant="primary">ذخیره</SubmitButton>
          {state?.ok && <span className="text-xs text-status-final">ذخیره شد.</span>}
        </div>
      )}
    </form>
  );
}

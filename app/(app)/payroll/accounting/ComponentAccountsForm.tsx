"use client";

import { useActionState } from "react";
import { savePayrollComponentAccounts, type ActionState } from "@/app/actions/payroll-approval";
import { FormError, SubmitButton } from "@/components/form";
import type { AccountOption } from "@/lib/payroll/review";
import { AccountSelect } from "./AccountingSettingsForm";

export function ComponentAccountsForm({
  componentId, code, name, typeLabel, type, accounts, expense, liability, canEdit,
}: {
  componentId: string; code: string; name: string; typeLabel: string; type: string;
  accounts: AccountOption[]; expense: string; liability: string; canEdit: boolean;
}) {
  const [state, run] = useActionState<ActionState, FormData>(savePayrollComponentAccounts, null);
  const needsExpense = type === "EARNING" || type === "EMPLOYER_COST";
  const needsLiability = type === "DEDUCTION" || type === "EMPLOYER_COST";
  const mapped = (!needsExpense || expense) && (!needsLiability || liability);
  return (
    <form action={run} className="rounded-lg border border-paper-line p-3">
      <input type="hidden" name="component_id" value={componentId} />
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">{name}</span>
        <span className="text-xs text-ink-muted">{code} — {typeLabel}</span>
        <span className={`badge ${mapped ? "status-final" : "status-waiting"}`}>{mapped ? "نگاشت شده" : "بدون نگاشت"}</span>
      </div>
      <FormError message={state?.error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {needsExpense ? (
          <label className="block"><span className="field-label">حساب هزینه (بدهکار)</span>
            <AccountSelect name="expense" accounts={accounts} defaultValue={expense} disabled={!canEdit} /></label>
        ) : <div />}
        {needsLiability ? (
          <label className="block"><span className="field-label">حساب بستانکار</span>
            <AccountSelect name="liability" accounts={accounts} defaultValue={liability} disabled={!canEdit} /></label>
        ) : <div />}
        {canEdit && <SubmitButton variant="primary">ذخیره</SubmitButton>}
      </div>
      {state?.ok && <p className="mt-1 text-xs text-status-final">ذخیره شد.</p>}
    </form>
  );
}

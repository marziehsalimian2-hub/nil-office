"use client";
import { useActionState } from "react";
import { setAccountingDefaults, type ActionState } from "@/app/actions/entities";
import { FormError } from "@/components/form";

type Opt = { id: string; label: string };

export function AccountingDefaultsForm({
  accounts,
  defaultArAccountId,
  defaultRevenueAccountId,
}: {
  accounts: Opt[];
  defaultArAccountId: string | null;
  defaultRevenueAccountId: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(setAccountingDefaults, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">حساب پیش‌فرض دریافتنی‌ها (بدهکار)</label>
          <select name="default_ar_account_id" defaultValue={defaultArAccountId ?? ""} className="input">
            <option value="">— انتخاب —</option>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
          </select>
        </div>
        <div>
          <label className="field-label">حساب پیش‌فرض درآمد فروش (بستانکار)</label>
          <select name="default_sales_revenue_account_id" defaultValue={defaultRevenueAccountId ?? ""} className="input">
            <option value="">— انتخاب —</option>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
          </select>
        </div>
      </div>
      <FormError message={state?.error} />
      <button className="btn-primary">ذخیره</button>
      <p className="text-xs text-ink-muted">این دو حساب برای «ایجاد پیش‌نویس حسابداری» از فاکتور استفاده می‌شوند.</p>
    </form>
  );
}

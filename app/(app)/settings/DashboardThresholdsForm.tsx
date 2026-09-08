"use client";
import { useActionState } from "react";
import { setDashboardThresholds } from "@/app/actions/entities";
import { FormError } from "@/components/form";

type ActionState = { error?: string } | null;

export function DashboardThresholdsForm({ contractExpiryDays, projectEndingSoonDays }: { contractExpiryDays: number; projectEndingSoonDays: number }) {
  const [state, action] = useActionState<ActionState, FormData>(setDashboardThresholds, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="field-label">هشدار پایان قرارداد (روز)</label>
        <input type="number" min={1} name="dashboard_contract_expiry_days" defaultValue={contractExpiryDays} className="input w-28" />
      </div>
      <div>
        <label className="field-label">هشدار پایان پروژه (روز)</label>
        <input type="number" min={1} name="dashboard_project_ending_soon_days" defaultValue={projectEndingSoonDays} className="input w-28" />
      </div>
      <button className="btn-primary">ذخیره</button>
      <div className="w-full"><FormError message={state?.error} /></div>
    </form>
  );
}

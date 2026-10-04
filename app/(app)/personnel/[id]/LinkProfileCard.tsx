"use client";

import { useActionState } from "react";
import { linkPersonnelProfile, type ActionState } from "@/app/actions/payroll-payslips";
import { Field, FormError, SubmitButton } from "@/components/form";
import { Card } from "@/components/ui";

export type ProfileOption = { id: string; label: string; takenBy: string | null };

/**
 * HR ADMIN only: link this personnel record to a login so the employee can open «فیش‌های حقوقی من».
 * The link is UNIQUE and can change only through this control (set_personnel_profile) — never by editing the record directly.
 */
export function LinkProfileCard({ personnelId, currentProfileId, options }: { personnelId: string; currentProfileId: string | null; options: ProfileOption[] }) {
  const [state, run] = useActionState<ActionState, FormData>(linkPersonnelProfile, null);
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-ink">اتصال به کاربر سامانه (دسترسی کارمند به فیش خودش)</h2>
      <p className="mb-3 text-xs text-ink-muted">
        هر کاربر فقط به یک پروندهٔ پرسنلی وصل می‌شود. کاربر متصل فقط فیش‌های حقوقی خودش را می‌بیند؛ هیچ دسترسی دیگری به اطلاعات حقوق دیگران ندارد.
        تغییر این اتصال دسترسی به فیش‌های قبلی را هم جابه‌جا می‌کند؛ با دقت انجام دهید.
      </p>
      <form action={run} className="space-y-3">
        <input type="hidden" name="personnel_id" value={personnelId} />
        <FormError message={state?.error} />
        <Field label="کاربر سامانه">
          <select name="profile_id" className="input" defaultValue={currentProfileId ?? ""}>
            <option value="">— بدون اتصال —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id} disabled={!!o.takenBy && o.id !== currentProfileId}>
                {o.label}{o.takenBy && o.id !== currentProfileId ? ` (متصل به ${o.takenBy})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center gap-3">
          <SubmitButton variant="primary">ذخیرهٔ اتصال</SubmitButton>
          {state?.ok && <span className="text-xs text-status-final">ذخیره شد.</span>}
        </div>
      </form>
    </Card>
  );
}

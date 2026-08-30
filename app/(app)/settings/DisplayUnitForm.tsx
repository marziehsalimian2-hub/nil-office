"use client";
import { useActionState } from "react";
import { setDisplayUnit, type ActionState } from "@/app/actions/accounting";
import { FormError } from "@/components/form";
export function DisplayUnitForm({ current }: { current: "RIAL" | "TOMAN" }) {
  const [state, action] = useActionState<ActionState, FormData>(setDisplayUnit, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1">
        <label className="field-label">واحد نمایش مبالغ</label>
        <select name="display_unit" defaultValue={current} className="input max-w-xs">
          <option value="RIAL">ریال</option>
          <option value="TOMAN">تومان</option>
        </select>
      </div>
      <button className="btn-primary">ذخیره</button>
      <div className="w-full"><FormError message={state?.error} /></div>
      <p className="w-full text-xs text-ink-muted">این تنظیم فقط برچسب واحد را تغییر می‌دهد؛ هیچ تبدیل خودکاری روی مبالغ انجام نمی‌شود.</p>
    </form>
  );
}

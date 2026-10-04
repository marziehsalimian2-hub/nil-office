"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/MoneyInput";

export type ComponentOption = {
  id: string;
  code: string;
  name_fa: string;
  method: string;
  hasRuleKey: boolean;
};
export type LineRow = { component_id: string; amount_override: string; percentage_override: string; notes: string };

const emptyRow = (): LineRow => ({ component_id: "", amount_override: "", percentage_override: "", notes: "" });

/** Dynamic rows (AllocationEditor-style): local state -> one hidden JSON input. Money stays an exact string. */
export function CompensationLinesEditor({ options, initial }: { options: ComponentOption[]; initial: LineRow[] }) {
  const [rows, setRows] = useState<LineRow[]>(initial);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  const payload = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => r.component_id)
          .map((r) => ({
            component_id: r.component_id,
            amount_override: r.amount_override || null,
            percentage_override: r.percentage_override || null,
            notes: r.notes || null,
          })),
      ),
    [rows],
  );

  const set = (i: number, patch: Partial<LineRow>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3 rounded-lg border border-paper-line p-3">
      <p className="text-sm font-medium text-ink">اجزای حقوق این نسخه</p>
      {options.length === 0 && <p className="text-xs text-ink-muted">هنوز جزء حقوقی فعالی تعریف نشده است (حقوق پایه در خود فرم ثبت می‌شود).</p>}
      {rows.map((r, i) => {
        const opt = byId.get(r.component_id);
        const canAmount = opt?.method === "FIXED" && !opt.hasRuleKey;
        const canPct = opt?.method === "PERCENTAGE" && !opt.hasRuleKey;
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-start">
            <select className="input !py-1.5" value={r.component_id} onChange={(e) => set(i, { component_id: e.target.value, amount_override: "", percentage_override: "" })}>
              <option value="">— جزء حقوقی —</option>
              {options.map((o) => (<option key={o.id} value={o.id}>{o.name_fa} ({o.code})</option>))}
            </select>
            {canAmount ? (
              <MoneyInput className="!py-1.5" value={r.amount_override} onChange={(v) => set(i, { amount_override: v })} placeholder="جایگزین مبلغ (اختیاری)" />
            ) : canPct ? (
              <input className="input !py-1.5 tnum" dir="ltr" inputMode="decimal" value={r.percentage_override} placeholder="جایگزین درصد (اختیاری)"
                onChange={(e) => set(i, { percentage_override: e.target.value })} />
            ) : (
              <div className="input flex items-center !py-1.5 text-xs text-ink-muted">
                {opt?.hasRuleKey ? "مقدار از قاعدهٔ قانونی" : opt ? "بدون جایگزینی (محاسبه در فاز بعد)" : "—"}
              </div>
            )}
            <input className="input !py-1.5" value={r.notes} placeholder="یادداشت" onChange={(e) => set(i, { notes: e.target.value })} />
            <button type="button" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} className="text-ink-muted hover:text-status-cancelled" aria-label="حذف">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])} className="btn-ghost !py-1 text-xs">
        <Plus className="h-3.5 w-3.5" /> افزودن جزء
      </button>
      <p className="text-xs text-ink-muted">تعریف هر جزء در «تاریخ شروع» این نسخه قفل می‌شود؛ تغییر بعدی تعریف جزء، این نسخه را عوض نمی‌کند.</p>
      <input type="hidden" name="lines" value={payload} />
    </div>
  );
}

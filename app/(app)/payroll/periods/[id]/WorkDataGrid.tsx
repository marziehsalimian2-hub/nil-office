"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWorkDataRows } from "@/app/actions/payroll-runs";
import { FormError } from "@/components/form";
import { MoneyInput } from "@/components/MoneyInput";
import { toEnDigits } from "@/lib/jalali";
import { CURRENCY_LABEL, type Currency } from "@/lib/enums";
import type { WorkGridRow } from "@/lib/payroll/review";

const QTY_FIELDS = [
  { key: "work_days", label: "روز کارکرد" },
  { key: "work_hours", label: "ساعت کارکرد" },
  { key: "overtime_hours", label: "اضافه‌کاری (ساعت)" },
  { key: "absence_days", label: "غیبت (روز)" },
  { key: "absence_hours", label: "غیبت (ساعت)" },
  { key: "paid_leave_days", label: "مرخصی با حقوق" },
  { key: "unpaid_leave_days", label: "مرخصی بدون حقوق" },
  { key: "mission_days", label: "ماموریت (روز)" },
  { key: "mission_hours", label: "ماموریت (ساعت)" },
] as const;
type QtyKey = (typeof QTY_FIELDS)[number]["key"];

type RowState = { qty: Record<QtyKey, string>; inputs: Record<string, string> };

function initial(row: WorkGridRow): RowState {
  const qty = {} as Record<QtyKey, string>;
  for (const f of QTY_FIELDS) qty[f.key] = row.work_data?.[f.key] ?? "";
  const inputs: Record<string, string> = {};
  for (const c of row.manual_components) inputs[c.component_id] = row.inputs[c.component_id]?.amount ?? "";
  return { qty, inputs };
}
// "1000.0000" from the DB -> "1000" for editing (string trim, no Number())
const trimZeros = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

export function WorkDataGrid({
  periodId, rows, canEdit, batchCurrencies,
}: { periodId: string; rows: WorkGridRow[]; canEdit: boolean; batchCurrencies: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<Record<string, RowState>>(() => {
    const s: Record<string, RowState> = {};
    for (const r of rows) {
      const i = initial(r);
      for (const k of QTY_FIELDS) i.qty[k.key] = trimZeros(i.qty[k.key]);
      for (const k of Object.keys(i.inputs)) i.inputs[k] = trimZeros(i.inputs[k]);
      s[r.personnel_id] = i;
    }
    return s;
  });
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const manualCols = useMemo(() => {
    const m = new Map<string, { code: string; name_fa: string }>();
    for (const r of rows) for (const c of r.manual_components) m.set(c.component_id, { code: c.code, name_fa: c.name_fa });
    return [...m.entries()];
  }, [rows]);

  const currencyCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.currency) m.set(r.currency, (m.get(r.currency) ?? 0) + 1);
    return [...m.entries()];
  }, [rows]);
  const missingBatchFor = currencyCounts.filter(([c]) => !batchCurrencies.includes(c));
  const noProfile = rows.filter((r) => !r.has_profile).length;

  function touch(pid: string, fn: (r: RowState) => RowState) {
    setState((s) => ({ ...s, [pid]: fn(s[pid]) }));
    setDirty((d) => new Set(d).add(pid));
    setSaved(false);
  }

  function fillZeros() {
    setState((s) => {
      const next = { ...s };
      const nd = new Set(dirty);
      for (const r of rows) {
        const cur = next[r.personnel_id];
        let changed = false;
        const inputs = { ...cur.inputs };
        for (const c of r.manual_components) if (!inputs[c.component_id]) { inputs[c.component_id] = "0"; changed = true; }
        if (changed) { next[r.personnel_id] = { ...cur, inputs }; nd.add(r.personnel_id); }
      }
      setDirty(nd);
      return next;
    });
    setSaved(false);
  }

  function save() {
    const payload = rows
      .filter((r) => dirty.has(r.personnel_id))
      .map((r) => {
        const s = state[r.personnel_id];
        const out: Record<string, unknown> = { personnel_id: r.personnel_id };
        for (const f of QTY_FIELDS) { const v = toEnDigits(s.qty[f.key].trim()); if (v) out[f.key] = v; }
        out.inputs = r.manual_components
          .filter((c) => s.inputs[c.component_id] !== "" && s.inputs[c.component_id] !== undefined)
          .map((c) => ({ component_id: c.component_id, amount: toEnDigits(s.inputs[c.component_id]), currency: r.currency ?? "" }));
        return out;
      });
    if (payload.length === 0) return;
    const fd = new FormData();
    fd.set("period_id", periodId);
    fd.set("rows", JSON.stringify(payload));
    start(async () => {
      const r = await saveWorkDataRows(null, fd);
      if (r?.error) { setError(r.error); setSaved(false); }
      else { setError(undefined); setSaved(true); setDirty(new Set()); router.refresh(); }
    });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">هیچ فردی در این دوره مشمول نیست (قرارداد فعال با همپوشانی دوره پیدا نشد).</p>;
  }

  return (
    <div className="space-y-3">
      {missingBatchFor.length > 0 && (
        <div className="rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-3 py-2 text-sm text-ink">
          هر دسته فقط یک واحد پول دارد. برای افرادی که حقوقشان به {missingBatchFor.map(([c, n]) => `${CURRENCY_LABEL[c as Currency] ?? c} (${n} نفر)`).join("، ")} است، باید دستهٔ جداگانه بسازید.
        </div>
      )}
      {noProfile > 0 && (
        <p className="text-xs text-status-cancelled">برخی افراد پروفایل حقوق ندارند و در محاسبه هشدار بحرانی می‌گیرند؛ پروفایل را در پروندهٔ پرسنلی ثبت کنید یا در دسته از محاسبه خارج‌شان کنید.</p>
      )}
      <FormError message={error} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="table-head">
              <th className="px-3 py-2 text-start">فرد</th>
              {QTY_FIELDS.map((f) => (<th key={f.key} className="px-2 py-2 text-start text-xs">{f.label}</th>))}
              {manualCols.map(([id, c]) => (<th key={id} className="px-2 py-2 text-start text-xs">{c.name_fa}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = state[r.personnel_id];
              const dim = r.currency && batchCurrencies.length > 0 && !batchCurrencies.includes(r.currency);
              return (
                <tr key={r.personnel_id} className={`table-row ${dim ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="flex flex-wrap gap-1 text-xs text-ink-muted">
                      <span className="tnum">{r.personnel_number}</span>
                      {!r.has_profile && <span className="badge status-cancelled">بدون پروفایل حقوق</span>}
                      {r.currency && <span>{CURRENCY_LABEL[r.currency as Currency] ?? r.currency}</span>}
                      {r.partial_period && <span className="badge status-waiting">بخشی از ماه</span>}
                    </div>
                  </td>
                  {QTY_FIELDS.map((f) => (
                    <td key={f.key} className="px-1 py-1">
                      <input className="input tnum !px-2 !py-1 w-20 text-center" inputMode="decimal" disabled={!canEdit}
                        value={s.qty[f.key]}
                        onChange={(e) => touch(r.personnel_id, (x) => ({ ...x, qty: { ...x.qty, [f.key]: e.target.value } }))} />
                    </td>
                  ))}
                  {manualCols.map(([id]) => {
                    const has = r.manual_components.some((c) => c.component_id === id);
                    return (
                      <td key={id} className="px-1 py-1">
                        {has ? (
                          <MoneyInput value={s.inputs[id] ?? ""} className="w-32"
                            onChange={(raw) => canEdit && touch(r.personnel_id, (x) => ({ ...x, inputs: { ...x.inputs, [id]: raw } }))} />
                        ) : <span className="text-ink-muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={pending || dirty.size === 0} onClick={save}>
            {pending ? "در حال ذخیره…" : `ذخیرهٔ تغییرات${dirty.size ? ` (${dirty.size})` : ""}`}
          </button>
          {manualCols.length > 0 && (
            <button type="button" className="btn-quiet" onClick={fillZeros}>تکمیل خالی‌ها با صفر</button>
          )}
          {saved && <span className="text-xs text-status-final">ذخیره شد. اگر دسته‌ای محاسبه شده بود، باید دوباره محاسبه شود.</span>}
        </div>
      )}
      <p className="text-xs text-ink-muted">
        اضافه‌کاری، غیبت و مرخصی فعلاً فقط ثبت و نمایش داده می‌شوند و اثر مالی خودکار ندارند؛ اثر مالی از طریق اجزای «ورود دستی» وارد می‌شود. مقدار خالی در اجزای ورود دستی به‌معنای «وارد نشده» است (در محاسبه هشدار بحرانی)؛ اگر مبلغی ندارد صفر وارد کنید.
      </p>
    </div>
  );
}

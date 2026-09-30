"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/MoneyInput";
import { formatMoney, type DisplayUnit } from "@/lib/money";
import { ALLOCATION_TARGET_TYPE, ALLOCATION_TARGET_TYPE_LABEL, type AllocationTargetType } from "@/lib/enums";

type TargetOpt = { id: string; label: string; total_amount: number };
export type AllocationRow = { target_type: AllocationTargetType; target_id: string; amount: string; description: string };

const emptyRow = (): AllocationRow => ({ target_type: "SALES_DOCUMENT", target_id: "", amount: "", description: "" });

/**
 * Splits a receipt/payment's amount across multiple settlement targets
 * (an invoice, a contract advance, or an unapplied on-account balance).
 * Mirrors JournalForm.tsx's dynamic-line-array pattern: local state ->
 * a JSON payload -> one hidden input. The actual over-allocation limits
 * are enforced server-side by set_cash_allocations(); the remaining-
 * capacity figures shown here are a UI hint only.
 */
export function AllocationEditor({
  name = "allocations",
  sourceAmount,
  salesDocuments,
  contracts,
  unit,
  initial,
}: {
  name?: string;
  sourceAmount?: number;
  salesDocuments: TargetOpt[];
  contracts: TargetOpt[];
  unit: DisplayUnit;
  initial?: AllocationRow[];
}) {
  const [rows, setRows] = useState<AllocationRow[]>(initial && initial.length > 0 ? initial : []);

  const payload = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => Number(r.amount) > 0 && (r.target_type === "ON_ACCOUNT" || r.target_id))
          .map((r) => ({
            target_type: r.target_type,
            target_id: r.target_type === "ON_ACCOUNT" ? null : r.target_id,
            amount: Number(r.amount) || 0,
            description: r.description || undefined,
          })),
      ),
    [rows],
  );

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

  const set = (i: number, patch: Partial<AllocationRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const optionsFor = (type: AllocationTargetType): TargetOpt[] =>
    type === "SALES_DOCUMENT" ? salesDocuments : type === "CONTRACT" ? contracts : [];

  return (
    <div className="space-y-3 rounded-lg border border-paper-line p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">تخصیص مبلغ</p>
        {typeof sourceAmount === "number" && (
          <span className={`badge ${Math.abs(total - sourceAmount) < 1e-6 ? "bg-seal-tint text-status-final" : "bg-paper text-ink-muted"}`}>
            {formatMoney(total, unit)} از {formatMoney(sourceAmount, unit)}
          </span>
        )}
      </div>

      {rows.length === 0 && <p className="text-xs text-ink-muted">هنوز تخصیصی ثبت نشده است.</p>}

      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto] sm:items-start">
          <select
            className="input !py-1.5"
            value={r.target_type}
            onChange={(e) => set(i, { target_type: e.target.value as AllocationTargetType, target_id: "" })}
          >
            {ALLOCATION_TARGET_TYPE.map((t) => (
              <option key={t} value={t}>{ALLOCATION_TARGET_TYPE_LABEL[t]}</option>
            ))}
          </select>
          {r.target_type === "ON_ACCOUNT" ? (
            <div className="input flex items-center !py-1.5 text-ink-muted">— بدون سند مشخص —</div>
          ) : (
            <select className="input !py-1.5" value={r.target_id} onChange={(e) => set(i, { target_id: e.target.value })}>
              <option value="">— انتخاب —</option>
              {optionsFor(r.target_type).map((o) => (
                <option key={o.id} value={o.id}>{o.label} ({formatMoney(o.total_amount, unit)})</option>
              ))}
            </select>
          )}
          <MoneyInput className="!py-1.5" value={r.amount} onChange={(v) => set(i, { amount: v })} />
          <button type="button" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} className="text-ink-muted hover:text-status-cancelled">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])} className="btn-ghost !py-1 text-xs">
        <Plus className="h-3.5 w-3.5" /> افزودن ردیف تخصیص
      </button>

      <input type="hidden" name={name} value={payload} />
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { updateJournalEntry } from "@/app/actions/accounting";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { MoneyInput } from "@/components/MoneyInput";
import { formatMoney, type DisplayUnit } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";

type AcctOpt = { id: string; code: string; name: string };
type SimpleOpt = { id: string; label: string };
type Line = {
  account_id: string;
  detail_account_id: string;
  description: string;
  debit: string;
  credit: string;
  company_id: string;
  case_id: string;
};

const empty = (): Line => ({ account_id: "", detail_account_id: "", description: "", debit: "", credit: "", company_id: "", case_id: "" });

export function EditableJournalCard({
  id,
  canEdit,
  accounts,
  details,
  companies,
  cases,
  fiscalYears,
  unit,
  header,
  initialLines,
  description,
}: {
  id: string;
  canEdit: boolean;
  accounts: AcctOpt[];
  details: SimpleOpt[];
  companies: SimpleOpt[];
  cases: SimpleOpt[];
  fiscalYears: SimpleOpt[];
  unit: DisplayUnit;
  header: { fiscal_year_id: string; document_date: string; reference: string | null };
  initialLines: Array<{ account_id: string; detail_account_id: string | null; description: string | null; debit: number; credit: number; company_id: string | null; case_id: string | null }>;
  description: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<Line[]>(() =>
    initialLines.length
      ? initialLines.map((l) => ({
          account_id: l.account_id,
          detail_account_id: l.detail_account_id ?? "",
          description: l.description ?? "",
          debit: l.debit > 0 ? String(l.debit) : "",
          credit: l.credit > 0 ? String(l.credit) : "",
          company_id: l.company_id ?? "",
          case_id: l.case_id ?? "",
        }))
      : [empty(), empty()],
  );

  const accMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) { d += Number(l.debit) || 0; c += Number(l.credit) || 0; }
    return { d, c, balanced: Math.abs(d - c) < 1e-6 && d > 0 };
  }, [lines]);

  const set = (i: number, k: keyof Line, v: string) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set(
      "lines",
      JSON.stringify(
        lines
          .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({
            account_id: l.account_id,
            detail_account_id: l.detail_account_id || null,
            description: l.description || null,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            company_id: l.company_id || null,
            case_id: l.case_id || null,
          })),
      ),
    );
    startTransition(async () => {
      const res = await updateJournalEntry(null, formData);
      if (res && "error" in res && res.error) {
        setError(res.error);
      } else {
        setError(undefined);
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <FormError message={error} />

        <div className="card space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="سال مالی" required>
              <select name="fiscal_year_id" required className="input" defaultValue={header.fiscal_year_id}>
                {fiscalYears.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
              </select>
            </Field>
            <Field label="تاریخ سند" required><JalaliDateInput name="document_date" required defaultISO={header.document_date} /></Field>
            <Field label="عطف / مرجع"><input name="reference" className="input" defaultValue={header.reference ?? ""} /></Field>
          </div>
          <Field label="شرح سند"><input name="description" className="input" defaultValue={description ?? ""} /></Field>
        </div>

        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead><tr className="table-head">
              <th className="px-3 py-2 text-right">حساب</th>
              <th className="px-3 py-2 text-right">تفصیلی</th>
              <th className="px-3 py-2 text-right">شرح</th>
              <th className="px-3 py-2 text-right">بدهکار</th>
              <th className="px-3 py-2 text-right">بستانکار</th>
              <th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-2">
                    <select className="input !py-1.5" value={l.account_id} onChange={(e) => set(i, "account_id", e.target.value)}>
                      <option value="">— انتخاب —</option>
                      {accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select className="input !py-1.5" value={l.detail_account_id} onChange={(e) => set(i, "detail_account_id", e.target.value)}>
                      <option value="">—</option>
                      {details.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
                    </select>
                  </td>
                  <td className="px-2 py-2"><input className="input !py-1.5" value={l.description} onChange={(e) => set(i, "description", e.target.value)} /></td>
                  <td className="px-2 py-2">
                    <MoneyInput className="!py-1.5" value={l.debit}
                      onChange={(v) => { set(i, "debit", v); if (v) set(i, "credit", ""); }} />
                  </td>
                  <td className="px-2 py-2">
                    <MoneyInput className="!py-1.5" value={l.credit}
                      onChange={(v) => { set(i, "credit", v); if (v) set(i, "debit", ""); }} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {lines.length > 2 && (
                      <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="text-ink-muted hover:text-status-cancelled">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-paper/60">
                <td colSpan={3} className="px-3 py-2 text-left text-sm font-medium text-ink-muted">جمع</td>
                <td className="px-3 py-2 tnum text-left font-semibold" dir="ltr">{toFaDigits(new Intl.NumberFormat("en-US").format(totals.d))}</td>
                <td className="px-3 py-2 tnum text-left font-semibold" dir="ltr">{toFaDigits(new Intl.NumberFormat("en-US").format(totals.c))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setLines((p) => [...p, empty()])} className="btn-ghost"><Plus className="h-4 w-4" /> افزودن ردیف</button>
          <span className={`badge ${totals.balanced ? "bg-seal-tint text-status-final" : "bg-paper text-status-cancelled"}`}>
            {totals.balanced ? "سند تراز است" : `اختلاف: ${formatMoney(Math.abs(totals.d - totals.c), unit)}`}
          </span>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "در حال ذخیره…" : "ذخیره تغییرات"}</button>
          <button type="button" disabled={pending} className="btn-quiet" onClick={() => setEditing(false)}>انصراف</button>
        </div>
      </form>
    );
  }

  const totalD = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalC = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

  return (
    <>
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> ویرایش سند
          </button>
        </div>
      )}
      {description && <p className="text-sm text-ink">{description}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead><tr className="table-head">
            <th className="px-4 py-3 text-right">حساب</th><th className="px-4 py-3 text-right">شرح</th>
            <th className="px-4 py-3 text-left">بدهکار</th><th className="px-4 py-3 text-left">بستانکار</th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const a = accMap.get(l.account_id);
              return (
                <tr key={i} className="table-row">
                  <td className="px-4 py-3 text-ink"><span className="tnum text-ink-muted" dir="ltr">{a?.code}</span> {a?.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{l.description || "—"}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{Number(l.debit) > 0 ? formatMoney(l.debit) : "—"}</td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{Number(l.credit) > 0 ? formatMoney(l.credit) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-line bg-paper/60 font-semibold">
            <td colSpan={2} className="px-4 py-3 text-left text-ink-muted">جمع ({unit === "RIAL" ? "ریال" : "تومان"})</td>
            <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(totalD)}</td>
            <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(totalC)}</td>
          </tr></tfoot>
        </table>
      </div>
    </>
  );
}

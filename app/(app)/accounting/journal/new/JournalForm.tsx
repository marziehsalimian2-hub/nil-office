"use client";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { createJournalEntry, type ActionState } from "@/app/actions/accounting";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { formatMoney, type DisplayUnit } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";

type AcctOpt = { id: string; code: string; name: string };
type SimpleOpt = { id: string; label: string };
type Line = { account_id: string; detail_account_id: string; description: string; debit: string; credit: string; company_id: string; case_id: string };

const empty = (): Line => ({ account_id: "", detail_account_id: "", description: "", debit: "", credit: "", company_id: "", case_id: "" });

export function JournalForm({
  accounts, details, companies, cases, fiscalYears, unit,
}: {
  accounts: AcctOpt[]; details: SimpleOpt[]; companies: SimpleOpt[]; cases: SimpleOpt[];
  fiscalYears: SimpleOpt[]; unit: DisplayUnit;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createJournalEntry, null);
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) { d += Number(l.debit) || 0; c += Number(l.credit) || 0; }
    return { d, c, balanced: Math.abs(d - c) < 1e-6 && d > 0 };
  }, [lines]);

  const payload = useMemo(
    () => JSON.stringify(
      lines.filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)).map((l) => ({
        account_id: l.account_id,
        detail_account_id: l.detail_account_id || null,
        description: l.description || null,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        company_id: l.company_id || null,
        case_id: l.case_id || null,
      })),
    ),
    [lines],
  );

  const set = (i: number, k: keyof Line, v: string) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <input type="hidden" name="lines" value={payload} />

      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="سال مالی" required>
            <select name="fiscal_year_id" required className="input" defaultValue={fiscalYears[0]?.id ?? ""}>
              {fiscalYears.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
            </select>
          </Field>
          <Field label="تاریخ سند" required><JalaliDateInput name="document_date" required /></Field>
          <Field label="عطف / مرجع"><input name="reference" className="input" /></Field>
        </div>
        <Field label="شرح سند"><input name="description" className="input" placeholder="شرح کلی سند" /></Field>
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
                  <input inputMode="numeric" dir="ltr" className="input !py-1.5 tnum text-left" value={l.debit}
                    onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); set(i, "debit", v); if (v) set(i, "credit", ""); }} />
                </td>
                <td className="px-2 py-2">
                  <input inputMode="numeric" dir="ltr" className="input !py-1.5 tnum text-left" value={l.credit}
                    onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); set(i, "credit", v); if (v) set(i, "debit", ""); }} />
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
        <SubmitButton variant="primary">ثبت پیش‌نویس سند</SubmitButton>
        <Link href="/accounting/journal" className="btn-quiet">انصراف</Link>
      </div>
      <p className="text-xs text-ink-muted">پس از ثبت پیش‌نویس، سند را از صفحهٔ جزئیات «ثبت قطعی» کنید تا شماره بگیرد و در گزارش‌ها لحاظ شود.</p>
    </form>
  );
}

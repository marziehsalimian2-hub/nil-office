"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import {
  addPaymentDestination, setPrimaryPaymentDestination, deactivatePaymentDestination, revealPaymentDestination,
} from "@/app/actions/payroll-compensation";
import { Card } from "@/components/ui";
import { Field, FormError } from "@/components/form";

/** Server passes MASKED values only; full values arrive solely through the audited reveal call and auto-hide. */
export type MaskedDestination = {
  id: string;
  bank_name: string;
  account_holder_name: string;
  account_masked: string | null;
  iban_masked: string | null;
  card_masked: string | null;
  is_primary: boolean;
  is_active: boolean;
};
type Revealed = { account_number: string | null; iban: string | null; card_number: string | null };

export function PaymentDestinationsCard({ personnelId, destinations }: { personnelId: string; destinations: MaskedDestination[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [showAdd, setShowAdd] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});

  useEffect(() => {
    const ids = Object.keys(revealed);
    if (ids.length === 0) return;
    const t = setTimeout(() => setRevealed({}), 30000);
    return () => clearTimeout(t);
  }, [revealed]);

  function act(fn: (p: null, f: FormData) => Promise<{ error?: string } | null>, id: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("personnel_id", personnelId);
    start(async () => {
      const r = await fn(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }
  function reveal(id: string) {
    if (revealed[id]) {
      setRevealed((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      return;
    }
    start(async () => {
      const r = await revealPaymentDestination(id);
      if (r.error) setError(r.error);
      else if (r.data) {
        setError(undefined);
        setRevealed((p) => ({ ...p, [id]: r.data! }));
      }
    });
  }
  function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("personnel_id", personnelId);
    start(async () => {
      const r = await addPaymentDestination(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(undefined);
        setShowAdd(false);
        router.refresh();
      }
    });
  }

  return (
    <Card className="space-y-3 border-status-cancelled/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">مقصد پرداخت (حساب بانکی)</p>
        <button type="button" className="btn-quiet !py-1 text-xs" onClick={() => setShowAdd((v) => !v)}>افزودن حساب</button>
      </div>
      <p className="text-xs text-ink-muted">داده‌ها رمزگذاری‌شده ذخیره نمی‌شوند؛ دسترسی فقط از طریق نقش مدیر حقوق و دستمزد، با نمایش پوشیده و ثبت رویداد مشاهده.</p>
      <FormError message={error} />

      {destinations.length === 0 && <p className="text-sm text-ink-muted">حسابی ثبت نشده است.</p>}
      <ul className="divide-y divide-paper-line/60">
        {destinations.map((d) => {
          const rv = revealed[d.id];
          return (
            <li key={d.id} className="space-y-1 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink">{d.bank_name} — {d.account_holder_name}</span>
                {d.is_primary && <span className="badge bg-paper text-status-received">اصلی</span>}
                {!d.is_active && <span className="badge bg-paper text-ink-muted">غیرفعال</span>}
              </div>
              <div className="tnum text-xs text-ink-muted" dir="ltr">
                {(rv ? rv.iban : d.iban_masked) && <p>IBAN: {rv ? rv.iban : d.iban_masked}</p>}
                {(rv ? rv.account_number : d.account_masked) && <p>Account: {rv ? rv.account_number : d.account_masked}</p>}
                {(rv ? rv.card_number : d.card_masked) && <p>Card: {rv ? rv.card_number : d.card_masked}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={pending} className="btn-quiet !py-0.5 text-xs" onClick={() => reveal(d.id)}>
                  {rv ? <><EyeOff className="h-3.5 w-3.5" /> پنهان</> : <><Eye className="h-3.5 w-3.5" /> نمایش کامل</>}
                </button>
                {d.is_active && !d.is_primary && (
                  <button type="button" disabled={pending} className="btn-quiet !py-0.5 text-xs" onClick={() => act(setPrimaryPaymentDestination, d.id)}>تعیین به‌عنوان اصلی</button>
                )}
                {d.is_active && (
                  <button type="button" disabled={pending} className="btn-quiet !py-0.5 text-xs text-status-cancelled"
                    onClick={() => confirm("غیرفعال‌سازی قابل بازگشت نیست. ادامه می‌دهید؟") && act(deactivatePaymentDestination, d.id)}>
                    غیرفعال‌سازی
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {showAdd && (
        <form onSubmit={submitAdd} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نام بانک" required><input name="bank_name" required className="input" /></Field>
            <Field label="نام صاحب حساب" required><input name="account_holder_name" required className="input" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="شبا (IR…)"><input name="iban" dir="ltr" className="input tnum" placeholder="IR + 24 رقم" /></Field>
            <Field label="شمارهٔ حساب"><input name="account_number" dir="ltr" className="input tnum" /></Field>
            <Field label="شمارهٔ کارت"><input name="card_number" dir="ltr" className="input tnum" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="is_primary" /> حساب اصلی</label>
          <p className="text-xs text-ink-muted">حداقل یکی از سه شناسه لازم است. مشخصات پس از ثبت قابل ویرایش نیست (غیرفعال و حساب جدید ثبت کنید).</p>
          <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-xs">{pending ? "در حال ذخیره…" : "ثبت حساب"}</button>
        </form>
      )}
    </Card>
  );
}

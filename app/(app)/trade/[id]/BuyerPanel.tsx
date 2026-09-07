"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Ban, RefreshCw } from "lucide-react";
import {
  assignTradeOfferBuyer,
  revokeTradeOfferBuyer,
  regenerateTradeOfferBuyerToken,
  type AssignBuyerResult,
  type ActionState,
} from "@/app/actions/trade";
import { Field, FormError, SubmitButton } from "@/components/form";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { TRADE_RESPONSE_TYPE_LABEL, type TradeResponseType } from "@/lib/enums";

type Company = { id: string; legal_name: string };
type BuyerRow = {
  id: string;
  company_id: string;
  company_name: string;
  revoked_at: string | null;
  token_expires_at: string;
  last_viewed_at: string | null;
  latest_response_type: TradeResponseType | null;
  latest_response_at: string | null;
};

function buildLink(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/offer/${token}`;
}

function TokenReveal({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = buildLink(token);
  return (
    <div className="rounded-lg border border-seal/30 bg-seal/5 p-3 text-sm">
      <p className="mb-2 font-medium text-ink">لینک دسترسی خریدار (فقط همین یک بار نمایش داده می‌شود):</p>
      <div className="flex items-center gap-2">
        <input readOnly dir="ltr" value={link} className="input flex-1 text-xs" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy className="h-4 w-4" /> {copied ? "کپی شد" : "کپی"}
        </button>
        <button type="button" className="btn-ghost" onClick={onDismiss}>باشه</button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">این لینک دیگر قابل بازیابی نیست؛ در صورت گم شدن باید لینک جدید صادر کنید.</p>
    </div>
  );
}

export function BuyerPanel({ offerId, companies, buyers }: { offerId: string; companies: Company[]; buyers: BuyerRow[] }) {
  const router = useRouter();
  const [assignState, assignAction] = useActionState<AssignBuyerResult | null, FormData>(assignTradeOfferBuyer, null);
  const [regenToken, setRegenToken] = useState<{ id: string; token: string } | null>(null);
  const [rowError, setRowError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function runVoid(action: (prev: ActionState, fd: FormData) => Promise<ActionState>, fields: Record<string, string>) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setRowError(res.error);
      else {
        setRowError(undefined);
        router.refresh();
      }
    });
  }

  function runRegenerate(assignmentId: string) {
    const fd = new FormData();
    fd.append("assignment_id", assignmentId);
    fd.append("offer_id", offerId);
    startTransition(async () => {
      const res = await regenerateTradeOfferBuyerToken(null, fd);
      if (res.error) setRowError(res.error);
      else if (res.token) {
        setRowError(undefined);
        setRegenToken({ id: assignmentId, token: res.token });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <form action={assignAction} className="card space-y-3 p-4">
        <input type="hidden" name="offer_id" value={offerId} />
        <p className="text-sm font-medium text-ink">افزودن خریدار</p>
        <FormError message={assignState && "error" in assignState ? assignState.error : undefined} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="شرکت خریدار" required>
            <select name="company_id" required className="input">
              <option value="">— انتخاب —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.legal_name}</option>))}
            </select>
          </Field>
          <Field label="اعتبار لینک (روز)" hint="پیش‌فرض ۳۰ روز">
            <input name="expires_in_days" type="number" min={1} max={365} defaultValue={30} className="input" />
          </Field>
          <div className="flex items-end">
            <SubmitButton variant="seal">صدور لینک دسترسی</SubmitButton>
          </div>
        </div>
        {assignState?.token && <TokenReveal token={assignState.token} onDismiss={() => router.refresh()} />}
      </form>

      <FormError message={rowError} />

      {buyers.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز خریداری برای این آفر تعیین نشده است.</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-3 py-2">شرکت</th><th className="px-3 py-2">وضعیت دسترسی</th>
              <th className="px-3 py-2">مشاهده</th><th className="px-3 py-2">آخرین پاسخ</th>
              <th className="px-3 py-2">اعتبار لینک</th><th className="px-3 py-2">عملیات</th>
            </tr></thead>
            <tbody>
              {buyers.map((b) => (
                <tr key={b.id} className="table-row">
                  <td className="px-3 py-2 text-ink">{b.company_name}</td>
                  <td className="px-3 py-2 text-ink-muted">{b.revoked_at ? "لغوشده" : "فعال"}</td>
                  <td className="px-3 py-2 text-ink-muted">{b.last_viewed_at ? formatJalali(b.last_viewed_at) : "مشاهده نشده"}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {b.latest_response_type ? `${TRADE_RESPONSE_TYPE_LABEL[b.latest_response_type]} — ${formatJalali(b.latest_response_at)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{formatJalali(b.token_expires_at)}</td>
                  <td className="px-3 py-2">
                    {!b.revoked_at && (
                      <div className="flex gap-2">
                        <button disabled={pending} className="btn-ghost !py-1 !px-2 text-xs" onClick={() => runRegenerate(b.id)}>
                          <RefreshCw className="h-3.5 w-3.5" /> صدور لینک جدید
                        </button>
                        <button
                          disabled={pending}
                          className="btn-ghost !py-1 !px-2 text-xs text-status-cancelled"
                          onClick={() => { if (confirm("دسترسی این خریدار لغو شود؟")) runVoid(revokeTradeOfferBuyer, { assignment_id: b.id, offer_id: offerId }); }}
                        >
                          <Ban className="h-3.5 w-3.5" /> لغو دسترسی
                        </button>
                      </div>
                    )}
                    {regenToken?.id === b.id && <div className="mt-2"><TokenReveal token={regenToken.token} onDismiss={() => setRegenToken(null)} /></div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

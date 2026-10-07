"use client";

import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/form";
import { saveVerifyDocType, saveVerifySettings, type VerifyActionState } from "@/app/actions/verify";
import { VERIFY_DOCUMENT_TYPE_LABEL, type VerifyDocumentType } from "@/lib/verify/types";

export type VerifySettingsRow = { enabled: boolean; issuer_name: string; public_label: string; show_contract_amount: boolean };
export type VerifyTypeRow = {
  document_type: VerifyDocumentType; enabled: boolean; page: "FIRST" | "LAST"; x_mm: number | string; y_mm: number | string; size_mm: number | string;
  show_label: boolean; show_code: boolean; label_text: string;
};

const Msg = ({ s }: { s: VerifyActionState }) => (s?.ok ? <p className="text-xs text-status-final">{s.message}</p> : <FormError message={s?.error} />);

function GlobalForm({ settings }: { settings: VerifySettingsRow }) {
  const [state, action] = useActionState<VerifyActionState, FormData>(saveVerifySettings, null);
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> استعلام اصالت (NIL Verify) فعال باشد</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-muted">نام صادرکننده روی صفحهٔ عمومی
          <input name="issuer_name" required maxLength={200} defaultValue={settings.issuer_name} className="input mt-1" />
        </label>
        <label className="text-xs text-ink-muted">عنوان صفحهٔ عمومی
          <input name="public_label" required maxLength={120} defaultValue={settings.public_label} className="input mt-1" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="show_contract_amount" defaultChecked={settings.show_contract_amount} /> مبلغ قرارداد در صفحهٔ عمومی نمایش داده شود (پیش‌فرض: خیر)
      </label>
      <p className="text-xs text-ink-muted">تغییر این گزینه فقط روی اسناد جدید اثر دارد؛ اطلاعات عمومی هر سند هنگام صدور ثبت و ثابت می‌شود.</p>
      <Msg s={state} />
      <SubmitButton variant="ghost">ذخیرهٔ تنظیمات کلی</SubmitButton>
    </form>
  );
}

function TypeForm({ row }: { row: VerifyTypeRow }) {
  const [state, action] = useActionState<VerifyActionState, FormData>(saveVerifyDocType, null);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-paper-line p-3">
      <input type="hidden" name="document_type" value={row.document_type} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{VERIFY_DOCUMENT_TYPE_LABEL[row.document_type]}</p>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="enabled" defaultChecked={row.enabled} /> فعال</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-ink-muted">صفحه
          <select name="page" defaultValue={row.page} className="input mt-1"><option value="LAST">صفحهٔ آخر</option><option value="FIRST">صفحهٔ اول</option></select>
        </label>
        <label className="text-xs text-ink-muted">فاصله از چپ (mm)
          <input name="x_mm" type="number" step="0.5" min={0} max={150} defaultValue={String(row.x_mm)} className="input tnum mt-1" />
        </label>
        <label className="text-xs text-ink-muted">فاصله از پایین (mm)
          <input name="y_mm" type="number" step="0.5" min={0} max={250} defaultValue={String(row.y_mm)} className="input tnum mt-1" />
        </label>
        <label className="text-xs text-ink-muted">اندازهٔ QR (mm)
          <input name="size_mm" type="number" step="0.5" min={15} max={60} defaultValue={String(row.size_mm)} className="input tnum mt-1" />
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-ink">
        <label className="flex items-center gap-2"><input type="checkbox" name="show_label" defaultChecked={row.show_label} /> نمایش عنوان</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="show_code" defaultChecked={row.show_code} /> نمایش کد استعلام</label>
      </div>
      <label className="block text-xs text-ink-muted">متن عنوان زیر QR
        <input name="label_text" required maxLength={120} defaultValue={row.label_text} className="input mt-1" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="ghost">ذخیرهٔ چیدمان</SubmitButton>
        <a href={`/api/verify/preview?type=${row.document_type}`} target="_blank" rel="noreferrer" className="btn-quiet">پیش‌نمایش روی سربرگ</a>
        <Msg s={state} />
      </div>
      <p className="text-[11px] text-ink-muted">برای فاکتور و قرارداد، حاشیهٔ پایین صفحه خودکار به‌اندازهٔ جای QR بزرگ‌تر می‌شود تا روی متن نیفتد. بعد از ذخیره، پیش‌نمایش را بررسی کنید.</p>
    </form>
  );
}

export function VerifySettingsForm({ settings, types }: { settings: VerifySettingsRow; types: VerifyTypeRow[] }) {
  return (
    <div className="space-y-5">
      <GlobalForm settings={settings} />
      <div className="space-y-3">{types.map((t) => (<TypeForm key={t.document_type} row={t} />))}</div>
    </div>
  );
}

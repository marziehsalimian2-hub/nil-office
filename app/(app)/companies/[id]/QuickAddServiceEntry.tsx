"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { quickAddServiceEntry } from "@/app/actions/service-entries";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import type { ServiceCategory } from "@/lib/types/database";

// Matches the exact "new Date().toISOString().slice(0,10)" convention
// already used across this app's other pages (dashboard, tasks list,
// projects dashboard) — lib/assistant/dates.ts's todayIso() is
// server-only and can't be imported into this client component.
const todayIsoClient = () => new Date().toISOString().slice(0, 10);

type Opt = { id: string; label: string };

/**
 * Single-screen fast entry (spec item #10): title, category, minutes,
 * optional expense — no arrangement/contract/project/task linking here.
 * "جزئیات بیشتر" expands to the full inline form (arrangement link,
 * cross-links, full expense fields) via advancedForm, passed in by the
 * parent tab so this component stays focused on the fast path only.
 */
export function QuickAddServiceEntry({
  companyId,
  clientServiceFileId,
  categories,
  defaultCurrency,
  advancedForm,
}: {
  companyId: string;
  clientServiceFileId: string;
  categories: Pick<ServiceCategory, "id" | "name">[];
  defaultCurrency: string;
  advancedForm?: React.ReactNode;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await quickAddServiceEntry(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setExpanded(false);
        router.refresh();
      }
    });
  }

  if (!expanded) {
    return (
      <button type="button" className="btn-primary gap-1.5" onClick={() => setExpanded(true)}>
        <Plus className="h-4 w-4" /> ثبت سریع خدمت
      </button>
    );
  }

  return (
    <Card className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="hidden" name="company_id" value={companyId} />
        <input type="hidden" name="client_service_file_id" value={clientServiceFileId} />
        <input type="hidden" name="currency" value={defaultCurrency} />
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عنوان خدمت" required>
            <input name="title" required className="input" placeholder="مثلاً پیگیری ثبت شرکت" />
          </Field>
          <Field label="دسته‌بندی" required>
            <select name="service_category_id" required className="input" defaultValue="">
              <option value="" disabled>
                انتخاب کنید
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="تاریخ" required>
            <input type="date" name="service_date" required defaultValue={todayIsoClient()} className="input tnum" />
          </Field>
          <Field label="مدت‌زمان (دقیقه)" required hint="مثلاً برای ۱ ساعت و ۳۰ دقیقه بنویسید ۹۰">
            <input type="number" name="duration_minutes" required min={1} className="input tnum" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="هزینهٔ اختیاری">
            <input type="number" name="expense_amount" min={0} step="any" className="input tnum" />
          </Field>
          <Field label="شرح هزینه">
            <input name="expense_description" className="input" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "در حال ذخیره…" : "ثبت"}
          </button>
          <button type="button" disabled={pending} className="btn-quiet" onClick={() => setExpanded(false)}>
            انصراف
          </button>
          {advancedForm && (
            <button type="button" className="btn-quiet text-xs" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "بستن جزئیات بیشتر" : "جزئیات بیشتر"}
            </button>
          )}
        </div>
      </form>
      {showAdvanced && advancedForm}
    </Card>
  );
}

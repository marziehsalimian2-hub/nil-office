import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, EmptyState } from "@/components/ui";
import {
  SALARY_COMPONENT_TYPE_LABEL, SALARY_CALCULATION_METHOD_LABEL, DEFERRED_CALCULATION_METHODS,
} from "@/lib/enums";
import type { SalaryComponent, SalaryComponentVersion } from "@/lib/types/database";
import { NoRuleBanner } from "../NoRuleBanner";

export const dynamic = "force-dynamic";

export default async function ComponentsPage() {
  const supabase = await createClient();
  const profile = await requireProfile();
  const canCreate = payrollAccess(profile).create;
  const { data } = await supabase
    .from("salary_components")
    .select("*, salary_component_versions(*)")
    .order("code");
  const rows = (data ?? []) as (SalaryComponent & { salary_component_versions: SalaryComponentVersion[] })[];

  return (
    <div>
      <PageHeader
        title="اجزای حقوق"
        subtitle="مزایا، کسورات و هزینه‌های کارفرما — هر تغییر یک نسخهٔ جدید است"
        action={canCreate ? (
          <Link href="/payroll/components/new" className="btn-seal"><Plus className="h-4 w-4" /> جزء جدید</Link>
        ) : undefined}
      />
      <NoRuleBanner />
      {rows.length === 0 ? (
        <EmptyState
          title="هنوز جزء حقوقی تعریف نشده است."
          hint="هیچ جزء یا مقداری از قبل ثبت نشده؛ اجزای مورد نیاز را خودتان تعریف کنید."
          action={canCreate ? <Link href="/payroll/components/new" className="btn-primary"><Plus className="h-4 w-4" /> جزء جدید</Link> : undefined}
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">کد</th>
                <th className="px-4 py-3">نام</th>
                <th className="px-4 py-3">نوع</th>
                <th className="px-4 py-3">روش محاسبه</th>
                <th className="px-4 py-3">مالیات/بیمه</th>
                <th className="px-4 py-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const open = c.salary_component_versions.find((v) => v.effective_to === null);
                return (
                  <tr key={c.id} className="table-row">
                    <td className="px-4 py-3">
                      <Link href={`/payroll/components/${c.id}`} className="font-medium text-seal hover:underline" dir="ltr">{c.code}</Link>
                    </td>
                    <td className="px-4 py-3 text-ink">{open?.name_fa ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{SALARY_COMPONENT_TYPE_LABEL[c.component_type]}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {open ? SALARY_CALCULATION_METHOD_LABEL[open.calculation_method] : "—"}
                      {open && DEFERRED_CALCULATION_METHODS.includes(open.calculation_method) && (
                        <span className="badge mr-2 bg-paper text-ink-muted">محاسبه در فاز بعد</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {open ? [open.taxable ? "مشمول مالیات" : null, open.insurable ? "مشمول بیمه" : null].filter(Boolean).join("، ") || "—" : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{c.is_active ? "فعال" : "غیرفعال"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

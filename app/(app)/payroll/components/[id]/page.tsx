import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, Card } from "@/components/ui";
import {
  SALARY_COMPONENT_TYPE_LABEL, SALARY_CALCULATION_METHOD_LABEL, PAYROLL_PERCENTAGE_BASIS_LABEL,
  DEFERRED_CALCULATION_METHODS, type PayrollPercentageBasis,
} from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import { formatCurrencyAmount } from "@/lib/payroll/format";
import type { SalaryComponent, SalaryComponentVersion } from "@/lib/types/database";
import { NoRuleBanner } from "../../NoRuleBanner";
import { ComponentForm } from "../ComponentForm";
import { ActiveToggle } from "../ActiveToggle";

export const dynamic = "force-dynamic";

function describeValue(v: SalaryComponentVersion): string {
  if (v.rule_key) return `از قاعدهٔ قانونی «${v.rule_key}» (در زمان محاسبه)`;
  if (v.calculation_method === "FIXED") return v.fixed_amount != null ? formatCurrencyAmount(v.fixed_amount, v.currency) : "بدون مبلغ پیش‌فرض";
  if (v.calculation_method === "PERCENTAGE") {
    const basis = v.percentage_basis ? PAYROLL_PERCENTAGE_BASIS_LABEL[v.percentage_basis as PayrollPercentageBasis] : "";
    return v.percentage != null ? `${v.percentage}% از ${basis}` : `درصد تعیین‌نشده (مبنا: ${basis})`;
  }
  return "—";
}

export default async function ComponentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const canCreate = payrollAccess(profile).create;

  const { data: component } = await supabase.from("salary_components").select("*").eq("id", id).single();
  if (!component) notFound();
  const c = component as SalaryComponent;
  const { data: versions } = await supabase
    .from("salary_component_versions")
    .select("*")
    .eq("component_id", id)
    .order("version_number", { ascending: false });
  const vs = (versions ?? []) as SalaryComponentVersion[];
  const current = vs.find((v) => v.effective_to === null) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={current?.name_fa ?? c.code}
        subtitle={`${c.code} — ${SALARY_COMPONENT_TYPE_LABEL[c.component_type]}`}
        action={canCreate ? <ActiveToggle componentId={c.id} isActive={c.is_active} /> : undefined}
      />
      <NoRuleBanner />

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">تعریف فعلی</p>
        {current ? (
          <div className="space-y-1.5 text-sm">
            <p><span className="text-ink-muted">روش: </span>{SALARY_CALCULATION_METHOD_LABEL[current.calculation_method]}
              {DEFERRED_CALCULATION_METHODS.includes(current.calculation_method) && <span className="badge mr-2 bg-paper text-ink-muted">محاسبه در فاز بعد</span>}</p>
            <p><span className="text-ink-muted">مقدار: </span>{describeValue(current)}</p>
            <p><span className="text-ink-muted">مشمول مالیات: </span>{current.taxable ? "بله" : "خیر"}
              <span className="text-ink-muted"> — مشمول بیمه: </span>{current.insurable ? "بله" : "خیر"}
              <span className="text-ink-muted"> — در فیش: </span>{current.display_on_payslip ? "نمایش" : "پنهان"}</p>
            <p><span className="text-ink-muted">معتبر از: </span><span className="tnum">{formatJalali(current.effective_from)}</span></p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">نسخهٔ بازی وجود ندارد.</p>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">تاریخچهٔ نسخه‌ها</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="table-head">
                <th className="px-3 py-2">نسخه</th><th className="px-3 py-2">نام</th><th className="px-3 py-2">مقدار</th>
                <th className="px-3 py-2">از</th><th className="px-3 py-2">تا پیش از</th><th className="px-3 py-2">یادداشت</th>
              </tr>
            </thead>
            <tbody>
              {vs.map((v) => (
                <tr key={v.id} className="table-row">
                  <td className="px-3 py-2 tnum text-ink">{v.version_number}</td>
                  <td className="px-3 py-2 text-ink">{v.name_fa}</td>
                  <td className="px-3 py-2 text-ink-muted">{describeValue(v)}</td>
                  <td className="px-3 py-2 tnum text-ink-muted">{formatJalali(v.effective_from)}</td>
                  <td className="px-3 py-2 tnum text-ink-muted">{v.effective_to ? formatJalali(v.effective_to) : "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{v.change_note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canCreate && current && (
        <div>
          <p className="mb-3 text-sm font-medium text-ink">ثبت نسخهٔ جدید</p>
          <ComponentForm mode="version" componentId={c.id} componentType={c.component_type} initial={current} />
        </div>
      )}
    </div>
  );
}

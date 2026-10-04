import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, Card } from "@/components/ui";
import { SALARY_COMPONENT_TYPE_LABEL, type SalaryComponentType } from "@/lib/enums";
import type { AccountOption } from "@/lib/payroll/review";
import type { PayrollAccountingSettings, PayrollComponentAccount } from "@/lib/types/database";
import { AccountingSettingsForm } from "./AccountingSettingsForm";
import { ComponentAccountsForm } from "./ComponentAccountsForm";

export const dynamic = "force-dynamic";

type Comp = { id: string; code: string; component_type: SalaryComponentType; is_active: boolean };

export default async function PayrollAccountingPage() {
  const supabase = await createClient();
  const profile = await requireProfile();
  const canEdit = payrollAccess(profile).admin;

  const [{ data: accounts }, { data: settings }, { data: comps }, { data: versions }, { data: maps }] = await Promise.all([
    supabase.rpc("payroll_accounting_accounts"),
    supabase.from("payroll_accounting_settings").select("*").maybeSingle(),
    supabase.from("salary_components").select("id, code, component_type, is_active").neq("component_type", "INFORMATIONAL").order("code"),
    supabase.from("salary_component_versions").select("component_id, name_fa").is("effective_to", null),
    supabase.from("payroll_component_accounts").select("*"),
  ]);
  const opts = (accounts ?? []) as AccountOption[];
  const st = (settings ?? null) as PayrollAccountingSettings | null;
  const nameOf = new Map(((versions ?? []) as { component_id: string; name_fa: string }[]).map((v) => [v.component_id, v.name_fa]));
  const mapOf = new Map(((maps ?? []) as PayrollComponentAccount[]).map((m) => [m.component_id, m]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="حسابداری حقوق"
        subtitle="نگاشت اجزای حقوق به سرفصل‌های حسابداری؛ هیچ حسابی از پیش تعیین نشده است و سند حسابداری فقط با نگاشت کامل ساخته می‌شود"
      />
      {!canEdit && <p className="text-sm text-ink-muted">تنظیم حساب‌ها فقط برای «مدیر حقوق و دستمزد» ممکن است؛ این صفحه برای شما فقط‌خواندنی است.</p>}
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-ink">حساب‌های ثابت سند حقوق</h2>
        <p className="mb-3 text-xs text-ink-muted">«هزینهٔ حقوق پایه» بدهکار می‌شود و «حقوق پرداختنی» بستانکار (جمع خالص همهٔ افراد، بدون تفکیک فرد).</p>
        <AccountingSettingsForm accounts={opts} baseSalary={st?.base_salary_expense_account_id ?? ""} netPayable={st?.net_payable_account_id ?? ""} canEdit={canEdit} />
      </Card>
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-ink">نگاشت اجزا</h2>
        <p className="mb-3 text-xs text-ink-muted">
          مزایا: حساب هزینه (بدهکار). کسورات: حساب بستانکار (مثلاً بیمه یا مالیات پرداختنی). هزینهٔ کارفرما: هر دو. اجزای «اطلاعاتی» وارد سند نمی‌شوند.
        </p>
        {(comps ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">هنوز جزء حقوقی تعریف نشده است.</p>
        ) : (
          <div className="space-y-3">
            {((comps ?? []) as Comp[]).map((c) => (
              <ComponentAccountsForm key={c.id} componentId={c.id} code={c.code} name={nameOf.get(c.id) ?? c.code}
                typeLabel={SALARY_COMPONENT_TYPE_LABEL[c.component_type]} type={c.component_type}
                accounts={opts} expense={mapOf.get(c.id)?.expense_account_id ?? ""} liability={mapOf.get(c.id)?.liability_account_id ?? ""}
                canEdit={canEdit} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import { PAYMENT_FREQUENCY_LABEL, SALARY_CALCULATION_METHOD_LABEL, type PaymentFrequency } from "@/lib/enums";
import { formatCurrencyAmount } from "@/lib/payroll/format";
import { describeQuantityVersion } from "@/lib/payroll/quantity";
import { maskIban, maskAccount, maskCard } from "@/lib/payroll/masking";
import type {
  CompensationProfile, CompensationLine, SalaryComponent, SalaryComponentVersion, PersonnelPaymentDestination,
} from "@/lib/types/database";
import { CompensationVersionForm } from "./CompensationVersionForm";
import { PaymentDestinationsCard, type MaskedDestination } from "./PaymentDestinationsCard";
import type { ComponentOption, LineRow } from "./CompensationLinesEditor";

type LineWithVersion = CompensationLine & {
  salary_component_versions: Pick<SalaryComponentVersion, "name_fa" | "calculation_method" | "fixed_amount" | "currency" | "percentage" | "rule_key" | "quantity_source" | "rate_mode" | "unit_divisor" | "divisor_rule_key" | "rate_multiplier" | "multiplier_rule_key"> | null;
};

/**
 * Built by the parent ONLY when the viewer has payroll access, so HR-only users never trigger any of these queries.
 * RLS (0117) is the real gate; bank rows additionally require the bank tier and are masked here before reaching the client.
 */
export async function CompensationTab({ personnelId, canManage, canViewBank }: { personnelId: string; canManage: boolean; canViewBank: boolean }) {
  const supabase = await createClient();

  const { data: profilesData } = await supabase
    .from("compensation_profiles")
    .select("*")
    .eq("personnel_id", personnelId)
    .order("version_number", { ascending: false });
  const versions = (profilesData ?? []) as CompensationProfile[];
  const current = versions.find((v) => v.effective_to === null) ?? null;
  const ids = versions.map((v) => v.id);

  const [{ data: linesData }, { data: componentsData }, { data: destData }, { data: events }] = await Promise.all([
    ids.length
      ? supabase
          .from("compensation_lines")
          .select("*, salary_component_versions(name_fa, calculation_method, fixed_amount, currency, percentage, rule_key, quantity_source, rate_mode, unit_divisor, divisor_rule_key, rate_multiplier, multiplier_rule_key)")
          .in("compensation_profile_id", ids)
      : Promise.resolve({ data: [] }),
    supabase.from("salary_components").select("*, salary_component_versions(*)").eq("is_active", true).order("code"),
    canViewBank
      ? supabase.from("personnel_payment_destinations").select("*").eq("personnel_id", personnelId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("activity_logs").select("id, action, created_at").eq("entity_type", "compensation_profiles").in("entity_id", ids).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
  ]);

  const lines = (linesData ?? []) as LineWithVersion[];
  const components = (componentsData ?? []) as (SalaryComponent & { salary_component_versions: SalaryComponentVersion[] })[];
  const codeById = new Map(components.map((c) => [c.id, c.code]));

  const options: ComponentOption[] = components
    .filter((c) => c.code !== "BASE_SALARY")
    .map((c): ComponentOption | null => {
      const open = c.salary_component_versions.find((v) => v.effective_to === null);
      return open ? { id: c.id, code: c.code, name_fa: open.name_fa, method: open.calculation_method, hasRuleKey: !!open.rule_key,
        perUnit: open.calculation_method === "QUANTITY_X_RATE" && open.rate_mode === "PER_UNIT" } : null;
    })
    .filter((o): o is ComponentOption => o !== null);

  const currentLines = current ? lines.filter((l) => l.compensation_profile_id === current.id) : [];
  const initialLines: LineRow[] = currentLines.map((l) => ({
    component_id: l.component_id,
    amount_override: l.amount_override != null ? String(l.amount_override) : "",
    percentage_override: l.percentage_override != null ? String(l.percentage_override) : "",
    notes: l.notes ?? "",
  }));

  const destinations: MaskedDestination[] = ((destData ?? []) as PersonnelPaymentDestination[]).map((d) => ({
    id: d.id,
    bank_name: d.bank_name,
    account_holder_name: d.account_holder_name,
    account_masked: maskAccount(d.account_number),
    iban_masked: maskIban(d.iban),
    card_masked: maskCard(d.card_number),
    is_primary: d.is_primary,
    is_active: d.is_active,
  }));

  function lineValue(l: LineWithVersion): string {
    const v = l.salary_component_versions;
    if (l.amount_override != null) return formatCurrencyAmount(l.amount_override, current?.currency);
    if (l.percentage_override != null) return `${l.percentage_override}%`;
    if (!v) return "—";
    if (v.rule_key) return `از قاعدهٔ «${v.rule_key}»`;
    if (v.calculation_method === "FIXED" && v.fixed_amount != null) return formatCurrencyAmount(v.fixed_amount, v.currency);
    if (v.calculation_method === "PERCENTAGE" && v.percentage != null) return `${v.percentage}%`;
    if (v.calculation_method === "QUANTITY_X_RATE") return describeQuantityVersion(v) ?? SALARY_CALCULATION_METHOD_LABEL[v.calculation_method];
    return SALARY_CALCULATION_METHOD_LABEL[v.calculation_method];
  }

  return (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">حقوق و مزایای فعلی</p>
        {current ? (
          <div className="space-y-3">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <p><span className="text-ink-muted">حقوق پایه: </span><span className="tnum text-ink">{formatCurrencyAmount(current.base_salary, current.currency)}</span></p>
              <p><span className="text-ink-muted">دورهٔ پرداخت: </span>{PAYMENT_FREQUENCY_LABEL[current.payment_frequency as PaymentFrequency] ?? current.payment_frequency}</p>
              <p><span className="text-ink-muted">معتبر از: </span><span className="tnum">{formatJalali(current.effective_from)}</span></p>
              {current.hourly_rate != null && <p><span className="text-ink-muted">نرخ ساعتی: </span><span className="tnum">{formatCurrencyAmount(current.hourly_rate, current.currency)}</span></p>}
            </div>
            {current.notes && <p className="text-sm text-ink-muted">{current.notes}</p>}
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">اجزای حقوق</p>
              {currentLines.length === 0 ? (
                <p className="text-sm text-ink-muted">جزء دیگری ثبت نشده است.</p>
              ) : (
                <ul className="divide-y divide-paper-line/60 text-sm">
                  {currentLines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between py-2">
                      <span className="text-ink">{l.salary_component_versions?.name_fa ?? "—"} <span className="text-xs text-ink-muted" dir="ltr">({codeById.get(l.component_id) ?? ""})</span></span>
                      <span className="tnum text-ink-muted">{lineValue(l)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-ink-muted">ساعات کاری استاندارد در تب «اشتغال» نگهداری می‌شود و اینجا تکرار نشده است.</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">هنوز نسخهٔ حقوقی ثبت نشده است.</p>
        )}
        {canManage && (
          <div className="mt-4">
            <CompensationVersionForm personnelId={personnelId} options={options} initialLines={initialLines} hasCurrent={!!current} />
          </div>
        )}
      </Card>

      {canViewBank ? (
        <PaymentDestinationsCard personnelId={personnelId} destinations={destinations} />
      ) : (
        <Card><p className="text-sm text-ink-muted">اطلاعات حساب بانکی فقط برای مدیر حقوق و دستمزد قابل مشاهده است.</p></Card>
      )}

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">تاریخچهٔ نسخه‌ها</p>
        {versions.length === 0 ? (
          <p className="text-sm text-ink-muted">—</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="table-head">
                  <th className="px-3 py-2">نسخه</th><th className="px-3 py-2">حقوق پایه</th><th className="px-3 py-2">از</th><th className="px-3 py-2">تا پیش از</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="table-row">
                    <td className="px-3 py-2 tnum text-ink">{v.version_number}</td>
                    <td className="px-3 py-2 tnum text-ink-muted">{formatCurrencyAmount(v.base_salary, v.currency)}</td>
                    <td className="px-3 py-2 tnum text-ink-muted">{formatJalali(v.effective_from)}</td>
                    <td className="px-3 py-2 tnum text-ink-muted">{v.effective_to ? formatJalali(v.effective_to) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {((events ?? []) as { id: string; action: string; created_at: string }[]).length > 0 && (
          <ul className="mt-4 divide-y divide-paper-line/60 border-t border-paper-line pt-2">
            {((events ?? []) as { id: string; action: string; created_at: string }[]).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-ink-muted">{e.action}</span>
                <span className="tnum text-ink-muted">{formatJalali(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

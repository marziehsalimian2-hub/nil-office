import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { SequenceForm } from "./SequenceForm";
import { DisplayUnitForm } from "./DisplayUnitForm";
import { AccountingRoleSelect } from "./AccountingRoleSelect";
import { ACCOUNTING_ROLE_LABEL } from "@/lib/enums";
import { currentJalaliYear, toFaDigits } from "@/lib/jalali";
import type { NumberSequence, Profile } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<string, string> = { OUTGOING: "صادره", INCOMING: "وارده", CASE: "پرونده" };
const ROLE_LABEL: Record<string, string> = { ADMIN: "مدیر", USER: "کاربر" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === "ADMIN";
  const supabase = await createClient();

  const [{ data: seqs }, { data: users }, { data: settings }] = await Promise.all([
    supabase.from("number_sequences").select("*").order("scope").order("year", { ascending: false }),
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("app_settings").select("display_unit").eq("id", 1).single(),
  ]);
  const displayUnit = (settings?.display_unit as "RIAL" | "TOMAN") ?? "RIAL";
  const sequences = (seqs ?? []) as NumberSequence[];
  const people = (users ?? []) as Profile[];

  return (
    <div>
      <PageHeader title="تنظیمات" subtitle="مقداردهی اولیهٔ شماره‌ها و کاربران" />

      {!isAdmin ? (
        <Card><p className="text-sm text-ink-muted">این بخش فقط برای مدیر سامانه در دسترس است.</p></Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <p className="mb-1 text-sm font-medium text-ink">واحد پول حسابداری</p>
            <p className="mb-4 text-xs text-ink-muted">واحد نمایش مبالغ در بخش مالی و حسابداری.</p>
            <DisplayUnitForm current={displayUnit} />
          </Card>

          <Card>
            <p className="mb-1 text-sm font-medium text-ink">مقداردهی اولیهٔ سری شماره‌ها</p>
            <p className="mb-4 text-xs text-ink-muted">برای انتقال بایگانی موجود بدون شماره‌گذاری مجدد استفاده می‌شود.</p>
            <SequenceForm currentYear={currentJalaliYear()} />
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">سری شماره‌های فعلی</p>
            {sequences.length === 0 ? (
              <p className="text-sm text-ink-muted">هنوز سری شماره‌ای تعریف نشده است.</p>
            ) : (
              <table className="w-full">
                <thead><tr className="table-head">
                  <th className="px-3 py-2">دامنه</th><th className="px-3 py-2">سال</th>
                  <th className="px-3 py-2">آخرین شماره</th><th className="px-3 py-2">شمارهٔ بعدی</th>
                </tr></thead>
                <tbody>
                  {sequences.map((s) => (
                    <tr key={s.id} className="table-row">
                      <td className="px-3 py-2 text-ink">{SCOPE_LABEL[s.scope] ?? s.scope}</td>
                      <td className="px-3 py-2 tnum text-ink-muted">{toFaDigits(s.year)}</td>
                      <td className="px-3 py-2 tnum text-ink-muted">{toFaDigits(s.last_value)}</td>
                      <td className="px-3 py-2 tnum font-medium text-seal">{toFaDigits(s.last_value + 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">کاربران</p>
            <table className="w-full">
              <thead><tr className="table-head">
                <th className="px-3 py-2">نام</th><th className="px-3 py-2">عنوان/سمت</th>
                <th className="px-3 py-2">نقش</th><th className="px-3 py-2">دسترسی مالی</th><th className="px-3 py-2">وضعیت</th>
              </tr></thead>
              <tbody>
                {people.map((u) => (
                  <tr key={u.id} className="table-row">
                    <td className="px-3 py-2 text-ink">{u.full_name || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted" dir="ltr">{u.title || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className="px-3 py-2">
                      {u.role === "ADMIN"
                        ? <span className="text-xs text-ink-muted">{ACCOUNTING_ROLE_LABEL.ADMIN} (کامل)</span>
                        : <AccountingRoleSelect userId={u.id} current={u.accounting_role} />}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{u.is_active ? "فعال" : "غیرفعال"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

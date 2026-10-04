import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { LEGAL_RULE_SET_STATUS, LEGAL_RULE_SET_STATUS_LABEL } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import { NoRuleBanner } from "./NoRuleBanner";

export const dynamic = "force-dynamic";

export default async function PayrollHomePage() {
  const supabase = await createClient();
  const [{ count: componentCount }, { data: ruleSets }, { count: periodCount }] = await Promise.all([
    supabase.from("salary_components").select("id", { count: "exact", head: true }),
    supabase.from("legal_rule_sets").select("status"),
    supabase.from("payroll_periods").select("id", { count: "exact", head: true }),
  ]);
  const byStatus = new Map<string, number>();
  for (const r of (ruleSets ?? []) as { status: string }[]) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  return (
    <div>
      <PageHeader title="حقوق و دستمزد" subtitle="دوره‌های حقوقی، محاسبه و بررسی؛ و تنظیمات پایه (اجزای حقوق و قواعد قانونی نسخه‌دار)" />
      <NoRuleBanner />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/payroll/periods">
          <Card className="transition hover:border-seal">
            <p className="text-sm font-medium text-ink">دوره‌های حقوقی</p>
            <p className="mt-1 text-xs text-ink-muted">کارکرد ماهانه، دستهٔ محاسبه برای هر واحد پول، محاسبه و بررسی</p>
            <p className="tnum mt-3 text-lg font-semibold text-ink">{toFaDigits(String(periodCount ?? 0))}</p>
          </Card>
        </Link>
        <Link href="/payroll/accounting">
          <Card className="transition hover:border-seal">
            <p className="text-sm font-medium text-ink">حسابداری حقوق</p>
            <p className="mt-1 text-xs text-ink-muted">نگاشت اجزای حقوق به سرفصل‌های حسابداری برای ساخت سند پیش‌نویس</p>
          </Card>
        </Link>
        <Link href="/payroll/components">
          <Card className="transition hover:border-seal">
            <p className="text-sm font-medium text-ink">اجزای حقوق</p>
            <p className="mt-1 text-xs text-ink-muted">تعریف مزایا، کسورات و هزینه‌های کارفرما (نسخه‌دار)</p>
            <p className="tnum mt-3 text-lg font-semibold text-ink">{toFaDigits(String(componentCount ?? 0))}</p>
          </Card>
        </Link>
        <Link href="/payroll/rule-sets">
          <Card className="transition hover:border-seal">
            <p className="text-sm font-medium text-ink">قواعد قانونی</p>
            <p className="mt-1 text-xs text-ink-muted">مجموعه‌های نسخه‌دار با گردش پیش‌نویس ← تأیید</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
              {LEGAL_RULE_SET_STATUS.map((s) => (
                <span key={s}>
                  {LEGAL_RULE_SET_STATUS_LABEL[s]}: <span className="tnum text-ink">{toFaDigits(String(byStatus.get(s) ?? 0))}</span>
                </span>
              ))}
            </div>
          </Card>
        </Link>
      </div>
      <p className="mt-6 text-xs text-ink-muted">
        حقوق و مزایای هر فرد در «پروندهٔ پرسنلی ← حقوق و مزایا» ثبت می‌شود. محاسبه، بررسی، تأیید نهایی و ساخت سند حسابداری پیش‌نویس در همین بخش انجام می‌شود؛ پرداخت و فیش حقوقی در فازهای بعدی ارائه خواهد شد.
      </p>
    </div>
  );
}

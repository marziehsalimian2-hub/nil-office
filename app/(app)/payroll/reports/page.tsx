import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { reportsOf } from "@/lib/reports/definitions";

export const dynamic = "force-dynamic";

export default function PayrollReportsHubPage() {
  return (
    <div>
      <PageHeader title="گزارش‌های حقوق و دستمزد" subtitle="همهٔ مبالغ به تفکیک واحد پول و دقیق (بدون گرد کردن اضافه)؛ هر گزارش خروجی CSV دارد" />
      <div className="grid gap-4 sm:grid-cols-2">
        {reportsOf("payroll").map((r) => (
          <Link key={r.key} href={`/payroll/reports/${r.key}`}>
            <Card className="h-full transition hover:border-seal">
              <p className="text-sm font-medium text-ink">{r.title}</p>
              <p className="mt-1 text-xs text-ink-muted">{r.description}</p>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-xs text-ink-muted">
        گزارش‌های منابع انسانی (دفتر پرسنلی، پرسنل فعال، سوابق استخدام) در بخش «پرسنل ← گزارش‌ها» هستند و هیچ مبلغی ندارند.
      </p>
    </div>
  );
}

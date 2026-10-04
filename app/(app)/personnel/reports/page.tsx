import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { reportsOf } from "@/lib/reports/definitions";

export const dynamic = "force-dynamic";

export default function HrReportsHubPage() {
  return (
    <div>
      <PageHeader title="گزارش‌های منابع انسانی" subtitle="بدون هیچ مبلغ یا اطلاعات حقوقی؛ هر گزارش خروجی CSV دارد" />
      <div className="grid gap-4 sm:grid-cols-2">
        {reportsOf("hr").map((r) => (
          <Link key={r.key} href={`/personnel/reports/${r.key}`}>
            <Card className="h-full transition hover:border-seal">
              <p className="text-sm font-medium text-ink">{r.title}</p>
              <p className="mt-1 text-xs text-ink-muted">{r.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

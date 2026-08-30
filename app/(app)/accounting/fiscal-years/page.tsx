import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { CloseButton } from "./CloseButton";
import { FISCAL_YEAR_STATUS_LABEL } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { FiscalYear } from "@/lib/types/database";
export const dynamic = "force-dynamic";
export default async function FiscalYearsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("fiscal_years").select("*").order("start_date", { ascending: false });
  const rows = (data ?? []) as FiscalYear[];
  return (
    <div>
      <PageHeader title="سال‌های مالی" subtitle="دوره‌های مالی و بستن سال"
        action={<Link href="/accounting/fiscal-years/new" className="btn-seal"><Plus className="h-4 w-4" /> سال مالی جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="هنوز سال مالی تعریف نشده است."
          action={<Link href="/accounting/fiscal-years/new" className="btn-primary"><Plus className="h-4 w-4" /> سال مالی جدید</Link>} />
      ) : (
        <div className="space-y-3">
          {rows.map((fy) => (
            <Card key={fy.id} className="flex flex-wrap items-center gap-4">
              <div className="flex-1">
                <p className="font-medium text-ink">{fy.title}</p>
                <p className="text-xs text-ink-muted tnum">{formatJalali(fy.start_date)} تا {formatJalali(fy.end_date)}</p>
              </div>
              <span className={`badge ${fy.status === "OPEN" ? "bg-seal-tint text-status-final" : "bg-paper text-ink-muted"}`}>
                {FISCAL_YEAR_STATUS_LABEL[fy.status]}
              </span>
              {fy.status === "OPEN" && <CloseButton id={fy.id} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

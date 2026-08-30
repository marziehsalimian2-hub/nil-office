import Link from "next/link";
import { Plus, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { FollowupComplete } from "@/components/FollowupComplete";
import { FOLLOWUP_STATUS_LABEL, type FollowupStatus } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { Followup } from "@/lib/types/database";
export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("followups").select("*").eq("status", "OPEN").order("due_date");
  const rows = (data ?? []) as Followup[];
  const overdue = rows.filter((f) => f.due_date < today);
  const dueToday = rows.filter((f) => f.due_date === today);
  const upcoming = rows.filter((f) => f.due_date > today);

  const Group = ({ title, items, tone }: { title: string; items: Followup[]; tone: string }) =>
    items.length === 0 ? null : (
      <Card>
        <p className={`mb-3 text-sm font-medium ${tone}`}>{title} <span className="tnum">({items.length})</span></p>
        <ul className="divide-y divide-paper-line/60">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
              <CalendarClock className="h-4 w-4 text-ink-muted" />
              <span className="flex-1 text-ink">{f.title}</span>
              <span className="text-xs text-ink-muted tnum">{formatJalali(f.due_date)}</span>
              <FollowupComplete id={f.id} />
            </li>
          ))}
        </ul>
      </Card>
    );

  return (
    <div>
      <PageHeader title="پیگیری‌ها" subtitle="یادآورها و کارهای در جریان"
        action={<Link href="/followups/new" className="btn-seal"><Plus className="h-4 w-4" /> پیگیری جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="پیگیری بازی وجود ندارد."
          action={<Link href="/followups/new" className="btn-primary"><Plus className="h-4 w-4" /> پیگیری جدید</Link>} />
      ) : (
        <div className="space-y-6">
          <Group title="گذشته از موعد" items={overdue} tone="text-status-cancelled" />
          <Group title="امروز" items={dueToday} tone="text-status-waiting" />
          <Group title="آینده" items={upcoming} tone="text-ink" />
        </div>
      )}
    </div>
  );
}

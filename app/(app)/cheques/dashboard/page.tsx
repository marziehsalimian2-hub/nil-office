import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = "(DRAFT,CLEARED,RETURNED,CANCELLED,VOID)"; // NOT IN -> still open

export default async function ChequeDashboardPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [
    { count: dueToday },
    { count: due7 },
    { count: due30 },
    { count: overdue },
    { count: issued },
    { count: delivered },
    { count: cleared },
    { count: returned },
  ] = await Promise.all([
    supabase.from("cheques").select("id", { count: "exact", head: true }).not("status", "in", ACTIVE_STATUSES).eq("cheque_date", today),
    supabase.from("cheques").select("id", { count: "exact", head: true }).not("status", "in", ACTIVE_STATUSES).gte("cheque_date", today).lte("cheque_date", in7),
    supabase.from("cheques").select("id", { count: "exact", head: true }).not("status", "in", ACTIVE_STATUSES).gte("cheque_date", today).lte("cheque_date", in30),
    supabase.from("cheques").select("id", { count: "exact", head: true }).not("status", "in", ACTIVE_STATUSES).lt("cheque_date", today),
    supabase.from("cheques").select("id", { count: "exact", head: true }).eq("status", "ISSUED"),
    supabase.from("cheques").select("id", { count: "exact", head: true }).eq("status", "DELIVERED"),
    supabase.from("cheques").select("id", { count: "exact", head: true }).eq("status", "CLEARED"),
    supabase.from("cheques").select("id", { count: "exact", head: true }).eq("status", "RETURNED"),
  ]);

  return (
    <div>
      <PageHeader title="داشبورد چک‌ها" subtitle="نمای کلی وضعیت چک‌های دریافتی و پرداختی" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="سررسید امروز" value={dueToday ?? 0} href="/cheques" tone="danger" />
        <StatCard label="سررسید ۷ روز آینده" value={due7 ?? 0} href="/cheques" tone="warn" />
        <StatCard label="سررسید ۳۰ روز آینده" value={due30 ?? 0} href="/cheques" />
        <StatCard label="سررسید گذشته" value={overdue ?? 0} href="/cheques" tone="danger" />
        <StatCard label="صادرشده" value={issued ?? 0} href="/cheques?status=ISSUED" />
        <StatCard label="تحویل‌شده" value={delivered ?? 0} href="/cheques?status=DELIVERED" />
        <StatCard label="وصول‌شده" value={cleared ?? 0} href="/cheques?status=CLEARED" tone="seal" />
        <StatCard label="برگشتی" value={returned ?? 0} href="/cheques?status=RETURNED" tone="danger" />
      </div>
    </div>
  );
}

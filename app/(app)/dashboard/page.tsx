import Link from "next/link";
import { Send, Inbox, FileText, FolderOpen, Plus, FileSignature, Receipt, Target, FolderKanban, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatCard, Card, EmptyState, StatusBadge } from "@/components/ui";
import { DIRECTION_LABEL, type CorrStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

function todayISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}
function dateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function count(
  q: PromiseLike<{ count: number | null }>,
): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const start = todayISO();
  const today = dateOnly();

  const [
    outToday,
    inToday,
    waiting,
    drafts,
    dueToday,
    overdue,
    upcoming,
    activeContracts,
  ] = await Promise.all([
    count(
      supabase
        .from("correspondence")
        .select("*", { count: "exact", head: true })
        .eq("direction", "OUTGOING")
        .gte("created_at", start) as never,
    ),
    count(
      supabase
        .from("correspondence")
        .select("*", { count: "exact", head: true })
        .eq("direction", "INCOMING")
        .gte("created_at", start) as never,
    ),
    count(
      supabase
        .from("correspondence")
        .select("*", { count: "exact", head: true })
        .eq("status", "WAITING_RESPONSE") as never,
    ),
    count(
      supabase
        .from("correspondence")
        .select("*", { count: "exact", head: true })
        .in("status", ["DRAFT", "REVIEW"]) as never,
    ),
    count(
      supabase
        .from("followups")
        .select("*", { count: "exact", head: true })
        .eq("status", "OPEN")
        .eq("due_date", today) as never,
    ),
    count(
      supabase
        .from("followups")
        .select("*", { count: "exact", head: true })
        .eq("status", "OPEN")
        .lt("due_date", today) as never,
    ),
    count(
      supabase
        .from("followups")
        .select("*", { count: "exact", head: true })
        .eq("status", "OPEN")
        .gt("due_date", today) as never,
    ),
    count(
      supabase
        .from("contracts")
        .select("*", { count: "exact", head: true })
        .eq("status", "ACTIVE") as never,
    ),
  ]);

  const { data: recent } = await supabase
    .from("correspondence")
    .select("id, direction, display_number, subject, status, created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  const quick = [
    { href: "/correspondence/outgoing/new", label: "نامه صادره", icon: Send },
    { href: "/correspondence/incoming/new", label: "نامه وارده", icon: Inbox },
    { href: "/documents/new", label: "سند جدید", icon: FileText },
    { href: "/cases/new", label: "پرونده جدید", icon: FolderOpen },
    { href: "/contracts/new", label: "قرارداد جدید", icon: FileSignature },
    { href: "/invoices/new", label: "فاکتور/پیش‌فاکتور جدید", icon: Receipt },
    { href: "/opportunities/new", label: "فرصت تجاری جدید", icon: Target },
    { href: "/projects/new", label: "پروژه جدید", icon: FolderKanban },
    { href: "/tasks/new", label: "کار جدید", icon: ListChecks },
  ];

  return (
    <>
      <PageHeader title="داشبورد" subtitle="نمای کلی فعالیت دبیرخانه" />

      <div className="mb-6 flex flex-wrap gap-2">
        {quick.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="btn-ghost">
            <Plus className="h-4 w-4 text-seal" />
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">فعالیت امروز</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="صادره امروز" value={toFaDigits(outToday)} tone="seal" />
          <StatCard label="وارده امروز" value={toFaDigits(inToday)} tone="seal" />
          <StatCard
            label="در انتظار پاسخ"
            value={toFaDigits(waiting)}
            tone="warn"
            href="/correspondence/outgoing"
          />
          <StatCard label="پیش‌نویس / بررسی" value={toFaDigits(drafts)} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">پیگیری‌ها</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="سررسید امروز" value={toFaDigits(dueToday)} href="/followups" />
          <StatCard
            label="عقب‌افتاده"
            value={toFaDigits(overdue)}
            tone="danger"
            href="/followups"
          />
          <StatCard label="آینده" value={toFaDigits(upcoming)} href="/followups" />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">قراردادها</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="قراردادهای فعال" value={toFaDigits(activeContracts)} tone="seal" href="/contracts" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">مکاتبات اخیر</h2>
        {recent && recent.length > 0 ? (
          <Card className="p-0">
            <table className="w-full">
              <thead>
                <tr className="table-head">
                  <th className="px-4 py-3">شماره</th>
                  <th className="px-4 py-3">نوع</th>
                  <th className="px-4 py-3">موضوع</th>
                  <th className="px-4 py-3">وضعیت</th>
                  <th className="px-4 py-3">تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="table-row">
                    <td className="px-4 py-3">
                      <Link
                        href={`/correspondence/${r.id}`}
                        className="tnum font-medium text-ink hover:text-seal"
                      >
                        {r.display_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {DIRECTION_LABEL[r.direction as "OUTGOING" | "INCOMING"]}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3">{r.subject ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status as CorrStatus} />
                    </td>
                    <td className="px-4 py-3 text-ink-muted tnum">
                      {formatJalali(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <EmptyState
            title="هنوز مکاتبه‌ای ثبت نشده است."
            hint="با ثبت اولین نامه صادره یا وارده شروع کنید."
          />
        )}
      </section>
    </>
  );
}

import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

async function count(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

export default async function WorkloadPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const { data: profiles } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const people = profiles ?? [];

  const rows = await Promise.all(
    people.map(async (p) => {
      const base = () => supabase.from("tasks").select("*", { count: "exact", head: true }).eq("assigned_to", p.id);
      const [open, overdue, inProgress, dueThisWeek] = await Promise.all([
        count(base().not("status", "in", "(DONE,CANCELLED)") as never),
        count(base().lt("due_date", today).not("status", "in", "(DONE,CANCELLED)") as never),
        count(base().eq("status", "IN_PROGRESS") as never),
        count(base().gte("due_date", today).lte("due_date", weekEnd).not("status", "in", "(DONE,CANCELLED)") as never),
      ]);
      return { id: p.id, name: p.full_name ?? "—", open, overdue, inProgress, dueThisWeek };
    }),
  );

  return (
    <div>
      <PageHeader title="حجم کاری تیم" subtitle="کارهای باز هر عضو تیم" />
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead><tr className="table-head">
            <th className="px-4 py-3">کاربر</th>
            <th className="px-4 py-3">کارهای باز</th>
            <th className="px-4 py-3">عقب‌افتاده</th>
            <th className="px-4 py-3">در حال انجام</th>
            <th className="px-4 py-3">مهلت این هفته</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="px-4 py-3 text-ink">{r.name}</td>
                <td className="px-4 py-3 tnum text-ink">{toFaDigits(r.open)}</td>
                <td className="px-4 py-3 tnum text-status-cancelled">{toFaDigits(r.overdue)}</td>
                <td className="px-4 py-3 tnum text-ink-muted">{toFaDigits(r.inProgress)}</td>
                <td className="px-4 py-3 tnum text-ink-muted">{toFaDigits(r.dueThisWeek)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

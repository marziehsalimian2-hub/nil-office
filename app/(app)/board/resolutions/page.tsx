import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { tehranDate } from "@/lib/board/time";
import { BOARD_FOLLOW_STATUS_LABEL, type BoardFollowStatus } from "@/lib/board/types";

export const dynamic = "force-dynamic";

type Row = {
  id: string; resolution_number: string | null; text: string; requires_action: boolean; due_date: string | null; follow_status: BoardFollowStatus;
  expected_output: string | null;
  owner: { full_name: string } | null;
  meeting: { id: string; meeting_number: number | null; scheduled_at: string; status: string } | null;
};

const FILTERS = [
  { key: "open", label: "باز" },
  { key: "overdue", label: "عقب‌افتاده" },
  { key: "done", label: "انجام‌شده" },
  { key: "all", label: "همه" },
] as const;

/** Ledger of APPROVED resolutions only (a draft's resolutions are not decisions yet). Phase 2 adds progress reports + closing. */
export default async function BoardResolutionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter: raw } = await searchParams;
  const filter = FILTERS.some((f) => f.key === raw) ? raw! : "open";
  const today = tehranDate(new Date())!;
  const supabase = await createClient();

  let q = supabase
    .from("board_resolutions")
    .select(
      "id, resolution_number, text, requires_action, due_date, follow_status, expected_output, owner:board_members!board_resolutions_owner_member_id_fkey(full_name), meeting:board_meetings!inner(id, meeting_number, scheduled_at, status)",
    )
    .eq("meeting.status", "APPROVED")
    .limit(500);
  if (filter === "open") q = q.eq("requires_action", true).not("follow_status", "in", "(DONE,NO_ACTION)");
  if (filter === "overdue") q = q.eq("requires_action", true).not("follow_status", "in", "(DONE,NO_ACTION)").lt("due_date", today);
  if (filter === "done") q = q.eq("follow_status", "DONE");
  const { data } = await q;
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) =>
    filter === "open" || filter === "overdue"
      ? (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
      : (b.meeting?.meeting_number ?? 0) - (a.meeting?.meeting_number ?? 0) ||
        (a.resolution_number ?? "").localeCompare(b.resolution_number ?? "", "en", { numeric: true }),
  );

  return (
    <div>
      <PageHeader title="دفتر مصوبات هیئت‌مدیره" subtitle="مصوبات صورت‌جلسات تأییدشده؛ متن مصوبه پس از تأیید تغییر نمی‌کند." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/board/resolutions?filter=${f.key}`} className={cn("btn-ghost", filter === f.key && "border-seal text-seal")}>{f.label}</Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="مصوبه‌ای برای نمایش وجود ندارد." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="table-head">
              <th className="px-3 py-2">شماره</th><th className="px-3 py-2">متن مصوبه</th><th className="px-3 py-2">مسئول</th>
              <th className="px-3 py-2">مهلت</th><th className="px-3 py-2">وضعیت</th><th className="px-3 py-2">جلسه</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const overdue = r.requires_action && !!r.due_date && r.due_date < today && !["DONE", "NO_ACTION"].includes(r.follow_status);
                return (
                  <tr key={r.id} className="table-row align-top">
                    <td className="px-3 py-2 tnum font-medium text-ink">{r.resolution_number ? toFaDigits(r.resolution_number) : "—"}</td>
                    <td className="max-w-xl px-3 py-2 text-ink">
                      <span className="line-clamp-3 whitespace-pre-line">{r.text}</span>
                      {r.expected_output && <span className="mt-1 block text-xs text-ink-muted">خروجی: {r.expected_output}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.owner?.full_name ?? "—"}</td>
                    <td className={cn("px-3 py-2 tnum", overdue ? "font-medium text-status-cancelled" : "text-ink-muted")}>{r.due_date ? formatJalali(r.due_date) : "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{overdue ? "عقب‌افتاده" : BOARD_FOLLOW_STATUS_LABEL[r.follow_status]}</td>
                    <td className="px-3 py-2 tnum">
                      {r.meeting && (
                        <Link href={`/board/meetings/${r.meeting.id}`} className="text-seal hover:underline">
                          {r.meeting.meeting_number ? toFaDigits(r.meeting.meeting_number) : "—"}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

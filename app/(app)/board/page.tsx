import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { toFaDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { boardDate, boardTime, boardWeekday, tehranDate } from "@/lib/board/time";
import {
  BOARD_MEETING_STATUS_LABEL, BOARD_MEETING_TYPE_LABEL, boardAccess, type BoardMeetingStatus, type BoardMeetingType,
} from "@/lib/board/types";

export const dynamic = "force-dynamic";

type Row = { id: string; meeting_number: number | null; meeting_type: BoardMeetingType; status: BoardMeetingStatus; scheduled_at: string; location: string };

export default async function BoardPage() {
  const profile = await requireProfile();
  const access = boardAccess(profile);
  const supabase = await createClient();
  const today = tehranDate(new Date())!;

  const [{ data: meetings }, { count: openCount }, { count: overdueCount }] = await Promise.all([
    supabase.from("board_meetings").select("id, meeting_number, meeting_type, status, scheduled_at, location").order("scheduled_at", { ascending: false }).limit(300),
    supabase.from("board_resolutions").select("id, board_meetings!inner(status)", { count: "exact", head: true })
      .eq("requires_action", true).not("follow_status", "in", "(DONE,NO_ACTION)").eq("board_meetings.status", "APPROVED"),
    supabase.from("board_resolutions").select("id, board_meetings!inner(status)", { count: "exact", head: true })
      .eq("requires_action", true).not("follow_status", "in", "(DONE,NO_ACTION)").eq("board_meetings.status", "APPROVED").lt("due_date", today),
  ]);
  const rows = (meetings ?? []) as Row[];
  const now = Date.now();
  const upcoming = rows.filter((m) => m.status === "DRAFT" && new Date(m.scheduled_at).getTime() >= now - 86_400_000)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const lastApproved = rows.find((m) => m.status === "APPROVED");

  return (
    <div>
      <PageHeader
        title="دبیرخانهٔ هیئت‌مدیره"
        subtitle="جلسات، صورت‌جلسات و پیگیری مصوبات هیئت‌مدیره"
        action={access.create && (
          <Link href="/board/meetings/new" className="btn-seal"><Plus className="h-4 w-4" /> جلسهٔ جدید</Link>
        )}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="جلسهٔ پیش رو" value={upcoming ? `${boardDate(upcoming.scheduled_at)}` : "—"} href={upcoming ? `/board/meetings/${upcoming.id}` : undefined} tone="seal" />
        <StatCard label="آخرین صورت‌جلسهٔ تأییدشده" value={lastApproved?.meeting_number ? `شمارهٔ ${toFaDigits(lastApproved.meeting_number)}` : "—"} href={lastApproved ? `/board/meetings/${lastApproved.id}` : undefined} />
        <StatCard label="مصوبات باز" value={toFaDigits(openCount ?? 0)} href="/board/resolutions" />
        <StatCard label="مصوبات عقب‌افتاده" value={toFaDigits(overdueCount ?? 0)} href="/board/resolutions?filter=overdue" tone={(overdueCount ?? 0) > 0 ? "danger" : "ink"} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="هنوز جلسه‌ای ثبت نشده است."
          hint="ابتدا اعضای هیئت‌مدیره را در «اعضا و تنظیمات» ثبت کنید، سپس اولین جلسه را بسازید."
          action={access.create && <Link href="/board/meetings/new" className="btn-primary"><Plus className="h-4 w-4" /> جلسهٔ جدید</Link>}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-3 py-2">شماره</th><th className="px-3 py-2">تاریخ</th><th className="px-3 py-2">ساعت</th>
              <th className="px-3 py-2">نوع</th><th className="px-3 py-2">محل</th><th className="px-3 py-2">وضعیت</th>
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="table-row">
                  <td className="px-3 py-2 tnum font-medium text-ink">
                    <Link href={`/board/meetings/${m.id}`} className="hover:text-seal">{m.meeting_number ? toFaDigits(m.meeting_number) : "—"}</Link>
                  </td>
                  <td className="px-3 py-2 tnum">
                    <Link href={`/board/meetings/${m.id}`} className="hover:text-seal">{boardWeekday(m.scheduled_at)} {boardDate(m.scheduled_at)}</Link>
                  </td>
                  <td className="px-3 py-2 tnum text-ink-muted">{boardTime(m.scheduled_at)}</td>
                  <td className="px-3 py-2 text-ink-muted">{BOARD_MEETING_TYPE_LABEL[m.meeting_type]}</td>
                  <td className="px-3 py-2 text-ink-muted">{m.location}</td>
                  <td className="px-3 py-2">
                    <span className={cn("badge bg-paper", m.status === "APPROVED" ? "status-final" : "status-draft")}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />{BOARD_MEETING_STATUS_LABEL[m.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Pre-approval checklist shown on a draft meeting. Mirrors the checks of board_approve_meeting (0147) so the secretary sees what is
 * missing BEFORE pressing «تأیید نهایی» — the RPC remains the authority. Pure.
 */
import type { BoardAgendaItem, BoardAttendance, BoardMeeting, BoardMember, BoardResolution } from "./types";
import { quorumInfo } from "./types";
import { tehranDate } from "./time";

export type ReadinessItem = { key: string; label: string; ok: boolean };

export function approvalReadiness(args: {
  meeting: Pick<BoardMeeting, "started_at" | "ended_at" | "chair_member_id" | "secretary_member_id" | "general_notes" | "scheduled_at">;
  members: Pick<BoardMember, "id" | "is_active">[];
  attendance: Pick<BoardAttendance, "member_id" | "status">[];
  agenda: Pick<BoardAgendaItem, "discussion">[];
  resolutions: Pick<BoardResolution, "requires_action" | "due_date">[];
}) {
  const { meeting: m, members, attendance, agenda, resolutions } = args;
  const att = new Map(attendance.map((a) => [a.member_id, a.status]));
  const active = members.filter((x) => x.is_active);
  const day = tehranDate(m.scheduled_at) ?? "";
  const presentCount = attendance.filter((a) => a.status === "PRESENT").length;
  const items: ReadinessItem[] = [
    { key: "times", label: "ساعت واقعی شروع و پایان جلسه", ok: !!m.started_at && !!m.ended_at },
    { key: "officials", label: "رئیس و دبیر جلسه تعیین شده‌اند", ok: !!m.chair_member_id && !!m.secretary_member_id },
    { key: "attendance", label: "وضعیت حضور همهٔ اعضای فعال ثبت شده است", ok: active.length > 0 && active.every((x) => att.has(x.id)) },
    {
      key: "officials_present", label: "رئیس و دبیر جلسه حاضرند",
      ok: !!m.chair_member_id && !!m.secretary_member_id && att.get(m.chair_member_id) === "PRESENT" && att.get(m.secretary_member_id) === "PRESENT",
    },
    { key: "agenda", label: "دست‌کم یک بند دستور جلسه", ok: agenda.length > 0 },
    { key: "discussion", label: "خلاصهٔ مذاکرات نوشته شده است", ok: !!m.general_notes?.trim() || agenda.some((a) => !!a.discussion?.trim()) },
    { key: "deadlines", label: "مهلت هیچ مصوبه‌ای قبل از تاریخ جلسه نیست", ok: resolutions.every((r) => !r.requires_action || !r.due_date || r.due_date >= day) },
  ];
  return { items, ready: items.every((i) => i.ok), quorum: quorumInfo(active.length, presentCount) };
}

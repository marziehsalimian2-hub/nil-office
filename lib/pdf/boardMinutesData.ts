import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderBoardMinutesPdf } from "@/lib/pdf/renderBoardMinutesPdf";
import { boardMinutesFileName } from "@/lib/pdf/boardMinutesHtml";
import type {
  BoardAgendaItem, BoardAttendance, BoardMeeting, BoardMember, BoardResolution, MinutesDoc, MinutesSnapshot,
} from "@/lib/board/types";

/**
 * The document behind a board-minutes PDF / page.
 * APPROVED -> the frozen snapshot, verbatim (later follow-up progress never changes the minutes).
 * DRAFT    -> assembled from the live tables, in the same shape and order as the approval RPC (0147) will freeze it, so the
 *             secretary previews exactly what will be approved (minus the numbers, which are issued at approval).
 * All reads run with the caller's session: RLS (0148) is the gate.
 */
export async function loadMinutesDoc(supabase: SupabaseClient, meetingId: string): Promise<{ doc: MinutesDoc; draft: boolean; meeting: BoardMeeting }> {
  const { data: meeting, error } = await supabase.from("board_meetings").select("*").eq("id", meetingId).maybeSingle();
  if (error || !meeting) throw new Error("جلسه یافت نشد.");
  const m = meeting as BoardMeeting;
  if (m.status === "APPROVED" && m.snapshot) return { doc: m.snapshot as MinutesSnapshot, draft: false, meeting: m };

  const [membersRes, attRes, agendaRes, resRes, prevRes] = await Promise.all([
    supabase.from("board_members").select("*"),
    supabase.from("board_attendance").select("*").eq("meeting_id", meetingId),
    supabase.from("board_agenda_items").select("*").eq("meeting_id", meetingId).order("position").order("created_at"),
    supabase.from("board_resolutions").select("*").eq("meeting_id", meetingId).order("position").order("created_at"),
    supabase
      .from("board_resolutions")
      .select("resolution_number, text, owner_member_id, due_date, follow_status, requires_action, board_meetings!inner(status, scheduled_at, meeting_number)")
      .eq("requires_action", true)
      .not("follow_status", "in", "(DONE,NO_ACTION)")
      .eq("board_meetings.status", "APPROVED")
      .lt("board_meetings.scheduled_at", m.scheduled_at),
  ]);
  const members = (membersRes.data ?? []) as BoardMember[];
  const byId = new Map(members.map((x) => [x.id, x]));
  const agenda = (agendaRes.data ?? []) as BoardAgendaItem[];
  const agendaPos = new Map(agenda.map((a) => [a.id, a.position]));
  const person = (id: string | null) => {
    const x = id ? byId.get(id) : undefined;
    return x ? { name: x.full_name, title: x.position_title } : null;
  };

  const attendance = ((attRes.data ?? []) as BoardAttendance[])
    .map((a) => ({ a, mem: byId.get(a.member_id) }))
    .filter((x): x is { a: BoardAttendance; mem: BoardMember } => !!x.mem)
    .sort((p, q) => p.mem.sort_order - q.mem.sort_order || p.mem.full_name.localeCompare(q.mem.full_name, "fa"))
    .map(({ a, mem }) => ({ member_id: mem.id, name: mem.full_name, title: mem.position_title, kind: mem.kind, status: a.status, note: a.note }));

  // same order as the approval RPC: agenda position (no agenda item last), then the resolution's own position
  const resolutions = ((resRes.data ?? []) as BoardResolution[])
    .slice()
    .sort((p, q) => (agendaPos.get(p.agenda_item_id ?? "") ?? 1e9) - (agendaPos.get(q.agenda_item_id ?? "") ?? 1e9) || p.position - q.position)
    .map((r) => ({
      id: r.id, number: null, agenda_item_id: r.agenda_item_id, text: r.text, requires_action: r.requires_action,
      owner_name: person(r.owner_member_id)?.name ?? null, due_date: r.due_date, expected_output: r.expected_output, vote_note: r.vote_note,
    }));

  type PrevRow = { resolution_number: string | null; text: string; owner_member_id: string | null; due_date: string | null; follow_status: MinutesDoc["previous_followups"][number]["follow_status"]; board_meetings: { meeting_number: number | null } | { meeting_number: number | null }[] };
  const meetingNo = (r: PrevRow) => (Array.isArray(r.board_meetings) ? r.board_meetings[0]?.meeting_number : r.board_meetings?.meeting_number) ?? 0;
  const resNo = (r: PrevRow) => Number((r.resolution_number ?? "0-0").split("-")[1] ?? 0);
  const previous_followups = ((prevRes.data ?? []) as PrevRow[])
    .sort((p, q) => meetingNo(p) - meetingNo(q) || resNo(p) - resNo(q))
    .map((r) => ({ number: r.resolution_number ?? "", text: r.text, owner_name: person(r.owner_member_id)?.name ?? null, due_date: r.due_date, follow_status: r.follow_status }));

  const doc: MinutesDoc = {
    meeting: {
      id: m.id, number: null, type: m.meeting_type, scheduled_at: m.scheduled_at, location: m.location, started_at: m.started_at,
      ended_at: m.ended_at, invitees: m.invitees, general_notes: m.general_notes, remaining_topics: m.remaining_topics,
    },
    chair: person(m.chair_member_id),
    secretary: person(m.secretary_member_id),
    attendance,
    agenda: agenda.map((a) => ({ id: a.id, position: a.position, title: a.title, discussion: a.discussion })),
    resolutions,
    previous_followups,
    approved_at: null,
    approved_by_name: null,
    next_meeting: null,
  };
  return { doc, draft: true, meeting: m };
}

export async function buildBoardMinutesPdf(
  supabase: SupabaseClient,
  meetingId: string,
  opts?: { minBottomMarginMm?: number },
): Promise<{ buffer: Buffer; fileName: string }> {
  const { doc, draft } = await loadMinutesDoc(supabase, meetingId);
  const buffer = await renderBoardMinutesPdf({ doc, draft, minBottomMarginMm: opts?.minBottomMarginMm });
  return { buffer, fileName: boardMinutesFileName(doc, draft) };
}

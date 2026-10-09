/** Board Secretariat — shared types and labels. Pure (importable from client components). */
import type { Profile } from "@/lib/types/database";

export const BOARD_MEETING_STATUS = ["DRAFT", "APPROVED"] as const;
export type BoardMeetingStatus = (typeof BOARD_MEETING_STATUS)[number];
export const BOARD_MEETING_STATUS_LABEL: Record<BoardMeetingStatus, string> = { DRAFT: "پیش‌نویس", APPROVED: "تأییدشده" };

export const BOARD_MEETING_TYPE = ["ORDINARY", "EXTRAORDINARY"] as const;
export type BoardMeetingType = (typeof BOARD_MEETING_TYPE)[number];
export const BOARD_MEETING_TYPE_LABEL: Record<BoardMeetingType, string> = { ORDINARY: "عادی", EXTRAORDINARY: "فوق‌العاده" };

export const BOARD_MEMBER_KIND = ["INTERNAL", "EXTERNAL"] as const;
export type BoardMemberKind = (typeof BOARD_MEMBER_KIND)[number];
export const BOARD_MEMBER_KIND_LABEL: Record<BoardMemberKind, string> = { INTERNAL: "داخلی", EXTERNAL: "بیرونی (غیرموظف)" };

export const BOARD_ATTENDANCE_STATUS = ["PRESENT", "ABSENT", "EXCUSED"] as const;
export type BoardAttendanceStatus = (typeof BOARD_ATTENDANCE_STATUS)[number];
export const BOARD_ATTENDANCE_LABEL: Record<BoardAttendanceStatus, string> = { PRESENT: "حاضر", ABSENT: "غایب", EXCUSED: "غایب با اطلاع" };

export const BOARD_FOLLOW_STATUS = ["OPEN", "IN_PROGRESS", "BLOCKED", "PENDING_REVIEW", "DONE", "NO_ACTION"] as const;
export type BoardFollowStatus = (typeof BOARD_FOLLOW_STATUS)[number];
export const BOARD_FOLLOW_STATUS_LABEL: Record<BoardFollowStatus, string> = {
  OPEN: "شروع نشده",
  IN_PROGRESS: "در حال انجام",
  BLOCKED: "متوقف",
  PENDING_REVIEW: "منتظر بررسی",
  DONE: "انجام‌شده",
  NO_ACTION: "بدون اقدام اجرایی",
};

export type BoardMember = {
  id: string;
  full_name: string;
  position_title: string | null;
  kind: BoardMemberKind;
  profile_id: string | null;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
};

export type BoardMeeting = {
  id: string;
  meeting_number: number | null;
  meeting_type: BoardMeetingType;
  status: BoardMeetingStatus;
  scheduled_at: string;
  location: string;
  started_at: string | null;
  ended_at: string | null;
  chair_member_id: string | null;
  secretary_member_id: string | null;
  invitees: string | null;
  general_notes: string | null;
  remaining_topics: string | null;
  approved_by: string | null;
  approved_at: string | null;
  snapshot: MinutesSnapshot | null;
  next_meeting_id: string | null;
  created_at: string;
};

export type BoardAgendaItem = { id: string; meeting_id: string; position: number; title: string; discussion: string | null };
export type BoardAttendance = { meeting_id: string; member_id: string; status: BoardAttendanceStatus; note: string | null };
export type BoardResolution = {
  id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  position: number;
  resolution_number: string | null;
  text: string;
  requires_action: boolean;
  owner_member_id: string | null;
  due_date: string | null;
  expected_output: string | null;
  vote_note: string | null;
  follow_status: BoardFollowStatus;
};

/** The frozen JSON stored on an APPROVED meeting (built by _board_minutes_snapshot + board_approve_meeting, 0147). */
export type MinutesSnapshot = {
  version: 1;
  meeting: {
    id: string;
    number: number;
    type: BoardMeetingType;
    scheduled_at: string;
    location: string;
    started_at: string;
    ended_at: string;
    invitees: string | null;
    general_notes: string | null;
    remaining_topics: string | null;
  };
  chair: { name: string; title: string | null } | null;
  secretary: { name: string; title: string | null } | null;
  attendance: { member_id: string; name: string; title: string | null; kind: BoardMemberKind; status: BoardAttendanceStatus; note: string | null }[];
  agenda: { id: string; position: number; title: string; discussion: string | null }[];
  resolutions: {
    id: string;
    number: string;
    agenda_item_id: string | null;
    text: string;
    requires_action: boolean;
    owner_name: string | null;
    due_date: string | null;
    expected_output: string | null;
    vote_note: string | null;
  }[];
  previous_followups: { number: string; text: string; owner_name: string | null; due_date: string | null; follow_status: BoardFollowStatus }[];
  approved_at: string;
  approved_by_name: string | null;
  next_meeting: { scheduled_at: string; location: string } | null;
};

/** Mirrors the DB helpers in 0145 — UI gating only; RLS / triggers / the approval RPC are the real gate. */
export function boardAccess(p: Pick<Profile, "role" | "board_role">) {
  const admin = p.role === "ADMIN";
  const r = p.board_role;
  return {
    view: admin || r != null,
    create: admin || r === "CREATE" || r === "APPROVE" || r === "ADMIN",
    approve: admin || r === "APPROVE" || r === "ADMIN",
    admin: admin || r === "ADMIN",
  };
}

/** Quorum hint shown before approval (more than half of the active members present). Advisory only — not enforced. */
export function quorumInfo(activeMembers: number, present: number) {
  const needed = Math.floor(activeMembers / 2) + 1;
  return { needed, present, met: activeMembers > 0 && present >= needed };
}

/** The issuer line printed on the minutes (same legal name NIL Verify uses by default, 0143). */
export const BOARD_COMPANY_NAME = "شرکت توسعه مدیریت راهبردی نیل";

/**
 * What the minutes renderer consumes: an approved snapshot as-is, or a DRAFT assembled from the live tables (no number yet,
 * times / numbers may still be missing). A MinutesSnapshot is always a valid MinutesDoc.
 */
export type MinutesDoc = Omit<MinutesSnapshot, "meeting" | "resolutions" | "approved_at" | "version"> & {
  meeting: Omit<MinutesSnapshot["meeting"], "number" | "started_at" | "ended_at"> & {
    number: number | null;
    started_at: string | null;
    ended_at: string | null;
  };
  resolutions: (Omit<MinutesSnapshot["resolutions"][number], "number"> & { number: string | null })[];
  approved_at: string | null;
};

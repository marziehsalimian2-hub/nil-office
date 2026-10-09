import { describe, it, expect } from "vitest";
import { addDays, boardDate, boardTime, combineTehran, normalizeTime, tehranDate, tehranTime } from "./time";
import { approvalReadiness } from "./readiness";
import { boardAccess, quorumInfo, type BoardAttendanceStatus } from "./types";
import {
  boardApproveSchema, boardMeetingUpdateSchema, boardMemberSchema, boardResolutionSchema, boardSettingsSchema,
} from "@/lib/validation-board";

describe("Tehran time helpers", () => {
  it("combines a Gregorian date + Tehran wall-clock time into a +03:30 instant", () => {
    expect(combineTehran("2026-10-20", "09:30")).toBe("2026-10-20T09:30:00+03:30");
    expect(new Date(combineTehran("2026-10-20", "09:30")!).toISOString()).toBe("2026-10-20T06:00:00.000Z");
    expect(combineTehran("2026-10-20", "24:00")).toBeNull();
    expect(combineTehran("1405/07/28", "09:30")).toBeNull();
    expect(combineTehran("", "09:30")).toBeNull();
  });
  it("reads the Tehran calendar date, not the UTC one (late evening UTC = next day in Tehran)", () => {
    expect(tehranDate("2026-10-19T21:00:00Z")).toBe("2026-10-20");
    expect(tehranTime("2026-10-19T21:00:00Z")).toBe("00:30");
    expect(tehranTime(combineTehran("2026-10-20", "17:45"))).toBe("17:45");
  });
  it("formats Jalali date and Persian-digit time", () => {
    expect(boardDate("2026-10-20T06:00:00Z")).toBe("۱۴۰۵/۰۷/۲۸");
    expect(boardTime("2026-10-20T06:00:00Z")).toBe("۰۹:۳۰");
    expect(boardDate(null)).toBe("—");
  });
  it("normalises typed times (Persian / Arabic digits, dot separator, missing leading zero)", () => {
    expect(normalizeTime("۹:۳۰")).toBe("09:30");
    expect(normalizeTime("9.05")).toBe("09:05");
    expect(normalizeTime("٠٩:٤٥")).toBe("09:45");
    expect(normalizeTime("25:00")).toBeNull();
    expect(normalizeTime("9")).toBeNull();
  });
  it("+14 days keeps the wall-clock time (Tehran has no DST)", () => {
    const next = addDays("2026-10-20T06:00:00.000Z", 14);
    expect(tehranDate(next)).toBe("2026-11-03");
    expect(tehranTime(next)).toBe("09:30");
  });
});

describe("access + quorum", () => {
  it("mirrors the 0145 tiers; a global ADMIN passes everything", () => {
    expect(boardAccess({ role: "USER" as never, board_role: null })).toEqual({ view: false, create: false, approve: false, admin: false });
    expect(boardAccess({ role: "USER" as never, board_role: "VIEW" })).toEqual({ view: true, create: false, approve: false, admin: false });
    expect(boardAccess({ role: "USER" as never, board_role: "CREATE" })).toEqual({ view: true, create: true, approve: false, admin: false });
    expect(boardAccess({ role: "USER" as never, board_role: "APPROVE" })).toEqual({ view: true, create: true, approve: true, admin: false });
    expect(boardAccess({ role: "ADMIN" as never, board_role: null })).toEqual({ view: true, create: true, approve: true, admin: true });
  });
  it("quorum = more than half of the active members", () => {
    expect(quorumInfo(5, 3)).toEqual({ needed: 3, present: 3, met: true });
    expect(quorumInfo(4, 2)).toEqual({ needed: 3, present: 2, met: false });
    expect(quorumInfo(0, 0).met).toBe(false);
  });
});

describe("approval readiness (mirrors board_approve_meeting)", () => {
  const base = {
    meeting: {
      started_at: "2026-10-20T06:00:00Z", ended_at: "2026-10-20T07:30:00Z", chair_member_id: "c", secretary_member_id: "s",
      general_notes: null, scheduled_at: "2026-10-20T06:00:00Z",
    },
    members: [{ id: "c", is_active: true }, { id: "s", is_active: true }, { id: "x", is_active: true }, { id: "old", is_active: false }],
    attendance: [{ member_id: "c", status: "PRESENT" }, { member_id: "s", status: "PRESENT" }, { member_id: "x", status: "ABSENT" }] as { member_id: string; status: BoardAttendanceStatus }[],
    agenda: [{ discussion: "بحث شد" }],
    resolutions: [{ requires_action: true, due_date: "2026-10-30" }, { requires_action: false, due_date: null }],
  };
  it("a complete draft is ready; inactive members need no roll call", () => {
    const r = approvalReadiness(base);
    expect(r.items.filter((i) => !i.ok)).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.quorum).toEqual({ needed: 2, present: 2, met: true });
  });
  it("flags each missing piece", () => {
    const keysOf = (over: Partial<typeof base>) => approvalReadiness({ ...base, ...over }).items.filter((i) => !i.ok).map((i) => i.key);
    expect(keysOf({ meeting: { ...base.meeting, ended_at: null as never } })).toEqual(["times"]);
    expect(keysOf({ attendance: base.attendance.slice(0, 2) })).toEqual(["attendance"]);
    expect(keysOf({ attendance: [{ member_id: "c", status: "PRESENT" }, { member_id: "s", status: "EXCUSED" }, { member_id: "x", status: "ABSENT" }] })).toEqual(["officials_present"]);
    expect(keysOf({ agenda: [] })).toEqual(["agenda", "discussion"]);
    expect(keysOf({ agenda: [{ discussion: "  " }] })).toEqual(["discussion"]);
    expect(keysOf({ resolutions: [{ requires_action: true, due_date: "2026-10-19" }] })).toEqual(["deadlines"]);
  });
  it("the meeting day is the TEHRAN date (a deadline on the meeting day itself is fine)", () => {
    const late = { ...base, meeting: { ...base.meeting, scheduled_at: "2026-10-19T21:00:00Z" } };   // 00:30 on 2026-10-20 in Tehran
    expect(approvalReadiness({ ...late, resolutions: [{ requires_action: true, due_date: "2026-10-20" }] }).items.find((i) => i.key === "deadlines")!.ok).toBe(true);
  });
});

describe("board validation", () => {
  it("an action resolution needs an owner AND a deadline", () => {
    const r = boardResolutionSchema.safeParse({ text: "تهیهٔ بودجه", requires_action: "on", owner_member_id: "", due_date: "", position: "1" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual(["due_date", "owner_member_id"]);
  });
  it("a non-action resolution drops owner / deadline / expected output", () => {
    const r = boardResolutionSchema.parse({
      text: "صورت‌های مالی تصویب شد.", owner_member_id: "6f1c0a52-8b0e-4bfe-9a49-2d0d2b6d1a11", due_date: "2026-11-01", expected_output: "x", position: "2",
    });
    expect(r.requires_action).toBe(false);
    expect([r.owner_member_id, r.due_date, r.expected_output]).toEqual([null, null, null]);
  });
  it("an external member is never linked to a NIL Office profile", () => {
    const m = boardMemberSchema.parse({ full_name: "عضو بیرونی", kind: "EXTERNAL", profile_id: "6f1c0a52-8b0e-4bfe-9a49-2d0d2b6d1a11", sort_order: "1", is_active: "on" });
    expect(m.profile_id).toBeNull();
    expect(m.is_active).toBe(true);
    expect(boardMemberSchema.safeParse({ full_name: "ا", kind: "INTERNAL", sort_order: "0" }).success).toBe(false);
  });
  it("meeting update: times normalised, empty optional fields become null", () => {
    const d = boardMeetingUpdateSchema.parse({ meeting_type: "ORDINARY", date: "2026-10-20", time: "۹:۰۰", location: "دفتر نیل", started_time: "9.10", ended_time: "", chair_member_id: "" });
    expect([d.time, d.started_time, d.ended_time, d.chair_member_id, d.general_notes]).toEqual(["09:00", "09:10", null, null, null]);
    expect(boardMeetingUpdateSchema.safeParse({ meeting_type: "ORDINARY", date: "2026-10-20", time: "9", location: "x" }).success).toBe(false);
  });
  it("approval needs the explicit confirmation, and a next-meeting date/time when one is requested", () => {
    const id = "6f1c0a52-8b0e-4bfe-9a49-2d0d2b6d1a11";
    expect(boardApproveSchema.safeParse({ meeting_id: id }).success).toBe(false);
    expect(boardApproveSchema.safeParse({ meeting_id: id, confirm: "on", create_next: "on", next_date: "", next_time: "" }).success).toBe(false);
    expect(boardApproveSchema.safeParse({ meeting_id: id, confirm: "on", create_next: "on", next_date: "2026-11-03", next_time: "09:30" }).success).toBe(true);
    expect(boardApproveSchema.safeParse({ meeting_id: id, confirm: "on" }).success).toBe(true);
  });
  it("settings: the numbering baseline is a non-negative integer", () => {
    expect(boardSettingsSchema.safeParse({ last_manual_meeting_number: "-1" }).success).toBe(false);
    expect(boardSettingsSchema.safeParse({ last_manual_meeting_number: "1.5" }).success).toBe(false);
    expect(boardSettingsSchema.parse({ last_manual_meeting_number: "12", default_location: "" })).toEqual({ last_manual_meeting_number: 12, default_location: null });
  });
});

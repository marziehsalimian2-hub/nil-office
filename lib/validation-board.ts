import { z } from "zod";
import { BOARD_ROLE } from "@/lib/enums";
import { BOARD_ATTENDANCE_STATUS, BOARD_MEETING_TYPE, BOARD_MEMBER_KIND } from "@/lib/board/types";
import { normalizeTime } from "@/lib/board/time";

const optText = (max: number) =>
  z.string().trim().max(max, `حداکثر ${max} نویسه مجاز است.`).optional().transform((v) => (v ? v : null));
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است (مثال: ۱۴۰۵/۰۷/۲۰).");
const optIsoDate = isoDate.optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null);
const time = z.string().transform((v, ctx) => {
  const t = normalizeTime(v);
  if (!t) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ساعت نامعتبر است (مثال: ۰۹:۳۰)." }); return z.NEVER; }
  return t;
});
const optTime = z.string().optional().transform((v, ctx) => {
  if (!v || !v.trim()) return null;
  const t = normalizeTime(v);
  if (!t) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ساعت نامعتبر است (مثال: ۰۹:۳۰)." }); return z.NEVER; }
  return t;
});
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
// (No .positive()/.gt() anywhere — see the assistant zod-schema gotcha; ranges via min/max on ints only.)
const smallInt = (max: number) => z.coerce.number().int().min(0).max(max);

export const boardRoleSchema = z.object({
  user_id: z.string().uuid(),
  board_role: z.enum(BOARD_ROLE).nullish(),
});

export const boardMemberSchema = z
  .object({
    full_name: z.string().trim().min(2, "نام عضو را وارد کنید.").max(200),
    position_title: optText(200),
    kind: z.enum(BOARD_MEMBER_KIND),
    profile_id: optUuid,
    sort_order: smallInt(1000).default(0),
    notes: optText(2000),
    is_active: checkbox,
  })
  .transform((d) => ({ ...d, profile_id: d.kind === "EXTERNAL" ? null : d.profile_id }));

export const boardMeetingCreateSchema = z.object({
  meeting_type: z.enum(BOARD_MEETING_TYPE),
  date: isoDate,
  time,
  location: z.string().trim().min(1, "محل جلسه را وارد کنید.").max(300),
});

export const boardMeetingUpdateSchema = z.object({
  meeting_type: z.enum(BOARD_MEETING_TYPE),
  date: isoDate,
  time,
  location: z.string().trim().min(1, "محل جلسه را وارد کنید.").max(300),
  started_time: optTime,
  ended_time: optTime,
  chair_member_id: optUuid,
  secretary_member_id: optUuid,
  invitees: optText(2000),
  general_notes: optText(20000),
  remaining_topics: optText(5000),
});

export const boardAgendaItemSchema = z.object({
  title: z.string().trim().min(1, "عنوان بند را وارد کنید.").max(500),
  discussion: optText(20000),
  position: z.coerce.number().int().min(1).max(500),
});

export const boardAttendanceStatusSchema = z.enum(BOARD_ATTENDANCE_STATUS);

export const boardResolutionSchema = z
  .object({
    text: z.string().trim().min(1, "متن مصوبه را وارد کنید.").max(10000),
    agenda_item_id: optUuid,
    requires_action: checkbox,
    owner_member_id: optUuid,
    due_date: optIsoDate,
    expected_output: optText(1000),
    vote_note: optText(2000),
    position: z.coerce.number().int().min(1).max(500),
  })
  .superRefine((d, ctx) => {
    if (d.requires_action && !d.owner_member_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owner_member_id"], message: "برای مصوبهٔ اجرایی، مسئول را انتخاب کنید." });
    if (d.requires_action && !d.due_date) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["due_date"], message: "برای مصوبهٔ اجرایی، مهلت را وارد کنید." });
  })
  .transform((d) => (d.requires_action ? d : { ...d, owner_member_id: null, due_date: null, expected_output: null }));

export const boardApproveSchema = z
  .object({
    meeting_id: z.string().uuid(),
    create_next: checkbox,
    next_date: optIsoDate,
    next_time: optTime,
    confirm: z.literal("on", { errorMap: () => ({ message: "تأیید نهایی را علامت بزنید." }) }),
  })
  .superRefine((d, ctx) => {
    if (d.create_next && (!d.next_date || !d.next_time)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["next_date"], message: "تاریخ و ساعت جلسهٔ بعد را وارد کنید." });
  });

export const boardSettingsSchema = z.object({
  last_manual_meeting_number: smallInt(99999),
  default_location: optText(300),
});

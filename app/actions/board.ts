"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { combineTehran } from "@/lib/board/time";
import { BOARD_ATTENDANCE_STATUS } from "@/lib/board/types";
import { issueBoardMinutesVerification } from "@/lib/verify/hooks";
import { randomUUID } from "node:crypto";
import { validateUpload, extensionOf, signatureCheckable, checkSignature } from "@/lib/upload-validation";
import { buildLinkUrl, generateLinkToken, hashLinkToken } from "@/lib/board/telegram/security";
import { dispatchBoardNotifications } from "@/lib/board/telegram/notify";
import {
  boardAgendaItemSchema, boardApproveSchema, boardMeetingCreateSchema, boardMeetingUpdateSchema, boardMemberSchema, boardResolutionSchema,
  boardRoleSchema, boardSettingsSchema, boardProgressSchema, boardCloseSchema,
} from "@/lib/validation-board";

/**
 * Board Secretariat server actions. They only shape input and report errors in Persian: every permission and every lock is enforced
 * by the database (RLS 0148, triggers 0146, board_approve_meeting 0147) — an approved meeting cannot be changed from here or anywhere.
 */
export type BoardActionState = { error?: string; ok?: boolean; message?: string; link?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}
const entries = (f: FormData) => Object.fromEntries(f.entries());
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "ورودی نامعتبر است.";
const uuid = z.string().uuid();
const meetingPath = (id: string) => `/board/meetings/${id}`;

/** PostgREST returns an RLS-blocked write as 0 rows, not an error: treat "nothing changed" as a refusal. */
const NO_ROWS = "این تغییر انجام نشد (دسترسی ندارید یا صورت‌جلسه قفل شده است).";

/* ------------------------------- role (Settings) ------------------------------- */

export async function setBoardRole(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const parsed = boardRoleSchema.safeParse({ user_id: f.get("user_id"), board_role: f.get("board_role") || null });
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("profiles").update({ board_role: parsed.data.board_role ?? null }).eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}

/* ------------------------------- members ------------------------------- */

export async function saveBoardMember(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const id = String(f.get("id") ?? "");
  const parsed = boardMemberSchema.safeParse(entries(f));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase, userId } = await ctx();
  if (id) {
    if (!uuid.safeParse(id).success) return { error: "ورودی نامعتبر است." };
    const { data, error } = await supabase.from("board_members").update(parsed.data).eq("id", id).select("id");
    if (error) return { error: persianError(error.message) };
    if (!data?.length) return { error: NO_ROWS };
  } else {
    const { error } = await supabase.from("board_members").insert({ ...parsed.data, created_by: userId });
    if (error) return { error: persianError(error.message) };
  }
  revalidatePath("/board/members");
  return { ok: true, message: "ذخیره شد." };
}

export async function deleteBoardMember(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const id = uuid.safeParse(f.get("id"));
  if (!id.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { data, error } = await supabase.from("board_members").delete().eq("id", id.data).select("id");
  if (error) {
    // a member referenced by any meeting can never be deleted (history) — deactivate instead
    if (error.code === "23503") return { error: "این عضو در جلسات ثبت شده است و حذف نمی‌شود؛ به‌جای حذف، او را غیرفعال کنید." };
    return { error: persianError(error.message) };
  }
  if (!data?.length) return { error: "حذف عضو فقط با دسترسی «مدیر دبیرخانه» ممکن است." };
  revalidatePath("/board/members");
  return { ok: true, message: "عضو حذف شد." };
}

/* ------------------------------- settings ------------------------------- */

export async function saveBoardSettings(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const parsed = boardSettingsSchema.safeParse(entries(f));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("board_settings")
    .update({ ...parsed.data, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("id");
  if (error) return { error: persianError(error.message) };
  if (!data?.length) return { error: "تنظیمات فقط با دسترسی «مدیر دبیرخانه» قابل تغییر است." };
  revalidatePath("/board/members");
  return { ok: true, message: "تنظیمات ذخیره شد." };
}

/* ------------------------------- meetings ------------------------------- */

export async function createBoardMeeting(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const parsed = boardMeetingCreateSchema.safeParse(entries(f));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const scheduled = combineTehran(parsed.data.date, parsed.data.time);
  if (!scheduled) return { error: "تاریخ یا ساعت جلسه نامعتبر است." };
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("board_meetings")
    .insert({ meeting_type: parsed.data.meeting_type, scheduled_at: scheduled, location: parsed.data.location, created_by: userId })
    .select("id")
    .single();
  if (error || !data) return { error: persianError(error?.message) };
  revalidatePath("/board");
  redirect(meetingPath(data.id));
}

export async function updateBoardMeeting(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const id = uuid.safeParse(f.get("meeting_id"));
  const parsed = boardMeetingUpdateSchema.safeParse(entries(f));
  if (!id.success) return { error: "ورودی نامعتبر است." };
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const scheduled = combineTehran(d.date, d.time);
  if (!scheduled) return { error: "تاریخ یا ساعت جلسه نامعتبر است." };
  // actual start / end are times on the meeting day
  const started = d.started_time ? combineTehran(d.date, d.started_time) : null;
  const ended = d.ended_time ? combineTehran(d.date, d.ended_time) : null;
  if (started && ended && ended < started) return { error: "ساعت پایان جلسه نمی‌تواند قبل از ساعت شروع باشد." };
  const { supabase } = await ctx();
  const { data, error } = await supabase
    .from("board_meetings")
    .update({
      meeting_type: d.meeting_type, scheduled_at: scheduled, location: d.location, started_at: started, ended_at: ended,
      chair_member_id: d.chair_member_id, secretary_member_id: d.secretary_member_id, invitees: d.invitees,
      general_notes: d.general_notes, remaining_topics: d.remaining_topics,
    })
    .eq("id", id.data)
    .select("id");
  if (error) return { error: persianError(error.message) };
  if (!data?.length) return { error: NO_ROWS };
  revalidatePath(meetingPath(id.data));
  return { ok: true, message: "مشخصات جلسه ذخیره شد." };
}

export async function deleteBoardMeeting(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const id = uuid.safeParse(f.get("meeting_id"));
  if (!id.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { data, error } = await supabase.from("board_meetings").delete().eq("id", id.data).select("id");
  if (error) return { error: persianError(error.message) };
  if (!data?.length) return { error: NO_ROWS };
  revalidatePath("/board");
  redirect("/board");
}

/* ------------------------------- agenda ------------------------------- */

export async function saveAgendaItem(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const meetingId = uuid.safeParse(f.get("meeting_id"));
  const itemId = String(f.get("id") ?? "");
  const parsed = boardAgendaItemSchema.safeParse(entries(f));
  if (!meetingId.success) return { error: "ورودی نامعتبر است." };
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase } = await ctx();
  if (itemId) {
    if (!uuid.safeParse(itemId).success) return { error: "ورودی نامعتبر است." };
    const { data, error } = await supabase.from("board_agenda_items").update(parsed.data).eq("id", itemId).eq("meeting_id", meetingId.data).select("id");
    if (error) return { error: persianError(error.message) };
    if (!data?.length) return { error: NO_ROWS };
  } else {
    const { error } = await supabase.from("board_agenda_items").insert({ ...parsed.data, meeting_id: meetingId.data });
    if (error) return { error: persianError(error.message) };
  }
  revalidatePath(meetingPath(meetingId.data));
  return { ok: true, message: "بند دستور جلسه ذخیره شد." };
}

export async function deleteAgendaItem(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const meetingId = uuid.safeParse(f.get("meeting_id"));
  const itemId = uuid.safeParse(f.get("id"));
  if (!meetingId.success || !itemId.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { data, error } = await supabase.from("board_agenda_items").delete().eq("id", itemId.data).eq("meeting_id", meetingId.data).select("id");
  if (error) return { error: persianError(error.message) };
  if (!data?.length) return { error: NO_ROWS };
  revalidatePath(meetingPath(meetingId.data));
  return { ok: true };
}

/* ------------------------------- attendance ------------------------------- */

/** One form for the whole roll call: fields `status_<memberId>` / `note_<memberId>`; an empty status removes that row. */
export async function saveAttendance(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const meetingId = uuid.safeParse(f.get("meeting_id"));
  if (!meetingId.success) return { error: "ورودی نامعتبر است." };
  const upserts: { meeting_id: string; member_id: string; status: string; note: string | null }[] = [];
  const removals: string[] = [];
  for (const [k, v] of f.entries()) {
    const m = /^status_([0-9a-f-]{36})$/.exec(k);
    if (!m) continue;
    const status = String(v);
    const note = String(f.get(`note_${m[1]}`) ?? "").trim().slice(0, 500) || null;
    if (!status) { removals.push(m[1]); continue; }
    if (!(BOARD_ATTENDANCE_STATUS as readonly string[]).includes(status)) return { error: "وضعیت حضور نامعتبر است." };
    upserts.push({ meeting_id: meetingId.data, member_id: m[1], status, note });
  }
  const { supabase } = await ctx();
  if (upserts.length) {
    const { error } = await supabase.from("board_attendance").upsert(upserts, { onConflict: "meeting_id,member_id" });
    if (error) return { error: persianError(error.message) };
  }
  if (removals.length) {
    const { error } = await supabase.from("board_attendance").delete().eq("meeting_id", meetingId.data).in("member_id", removals);
    if (error) return { error: persianError(error.message) };
  }
  revalidatePath(meetingPath(meetingId.data));
  return { ok: true, message: "حضور و غیاب ذخیره شد." };
}

/* ------------------------------- resolutions ------------------------------- */

export async function saveResolution(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const meetingId = uuid.safeParse(f.get("meeting_id"));
  const resId = String(f.get("id") ?? "");
  const parsed = boardResolutionSchema.safeParse(entries(f));
  if (!meetingId.success) return { error: "ورودی نامعتبر است." };
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase, userId } = await ctx();
  if (resId) {
    if (!uuid.safeParse(resId).success) return { error: "ورودی نامعتبر است." };
    const { data, error } = await supabase.from("board_resolutions").update(parsed.data).eq("id", resId).eq("meeting_id", meetingId.data).select("id");
    if (error) return { error: persianError(error.message) };
    if (!data?.length) return { error: NO_ROWS };
  } else {
    const { error } = await supabase.from("board_resolutions").insert({ ...parsed.data, meeting_id: meetingId.data, created_by: userId });
    if (error) return { error: persianError(error.message) };
  }
  revalidatePath(meetingPath(meetingId.data));
  return { ok: true, message: "مصوبه ذخیره شد." };
}

export async function deleteResolution(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const meetingId = uuid.safeParse(f.get("meeting_id"));
  const resId = uuid.safeParse(f.get("id"));
  if (!meetingId.success || !resId.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { data, error } = await supabase.from("board_resolutions").delete().eq("id", resId.data).eq("meeting_id", meetingId.data).select("id");
  if (error) return { error: persianError(error.message) };
  if (!data?.length) return { error: NO_ROWS };
  revalidatePath(meetingPath(meetingId.data));
  return { ok: true };
}

/* ------------------------------- approval ------------------------------- */

/**
 * Final approval by the secretary: the RPC checks completeness, issues the continuous meeting number + resolution numbers, optionally
 * creates the next meeting as a DRAFT, and locks everything. Then the frozen QR PDF is issued (NIL Verify) — best effort: a failure
 * leaves the verification PENDING with a retry button and never undoes the approval.
 */
export async function approveBoardMeeting(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const parsed = boardApproveSchema.safeParse(entries(f));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  let next: string | null = null;
  if (d.create_next) {
    next = combineTehran(d.next_date, d.next_time);
    if (!next) return { error: "تاریخ یا ساعت جلسهٔ بعد نامعتبر است." };
  }
  const { supabase, userId } = await ctx();
  const { error } = await supabase.rpc("board_approve_meeting", { p_meeting_id: d.meeting_id, p_next_scheduled_at: next });
  if (error) return { error: persianError(error.message) };
  const v = await issueBoardMinutesVerification(supabase, userId, d.meeting_id);
  if (v.status === "PENDING") console.error("approveBoardMeeting: verification stayed PENDING", d.meeting_id, v.error);
  // Phase 2: the frozen minutes to every linked member + each owner's new resolutions (best effort — never undoes the approval)
  const { error: qErr } = await supabase.rpc("board_enqueue_minutes", { p_meeting: d.meeting_id });
  if (qErr) console.error("approveBoardMeeting: enqueue minutes failed", qErr.message);
  else await dispatchBoardNotifications(50);
  revalidatePath("/board");
  revalidatePath("/board/resolutions");
  redirect(meetingPath(d.meeting_id));
}

/* ------------------------------- Phase 2: follow-up ------------------------------- */

const resolutionPath = (id: string) => `/board/resolutions/${id}`;

/** Uploads evidence files under the resolution's own folder (storage policy: board CREATE tier). Returns the RPC's files payload. */
async function uploadEvidence(
  supabase: Awaited<ReturnType<typeof createClient>>, meetingId: string, resolutionId: string, files: File[],
): Promise<{ files: { storage_path: string; file_name: string; mime_type: string | null; size_bytes: number }[] } | { error: string }> {
  if (files.length > 10) return { error: "حداکثر ۱۰ فایل برای هر گزارش مجاز است." };
  const out: { storage_path: string; file_name: string; mime_type: string | null; size_bytes: number }[] = [];
  for (const file of files) {
    const check = validateUpload(file.name, file.type, file.size);
    if (!check.ok) return { error: `${file.name}: ${check.error}` };
    const ext = extensionOf(file.name)!;
    if (signatureCheckable(ext)) {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      if (!checkSignature(ext, head)) return { error: `${file.name}: محتوای فایل با پسوند آن هم‌خوان نیست.` };
    }
    const path = `board_meeting/${meetingId}/followup/${resolutionId}/${randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("nil-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) {
      if (out.length) await supabase.storage.from("nil-files").remove(out.map((f) => f.storage_path));
      return { error: "بارگذاری فایل ناموفق بود." };
    }
    out.push({ storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type || null, size_bytes: file.size });
  }
  return { files: out };
}

/** Progress recorded on the web (e.g. reported by phone or in a meeting) — with optional evidence files. */
export async function reportResolutionProgress(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const parsed = boardProgressSchema.safeParse(entries(f));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase } = await ctx();
  const { data: r } = await supabase.from("board_resolutions").select("id, meeting_id").eq("id", parsed.data.resolution_id).maybeSingle();
  if (!r) return { error: "مصوبه یافت نشد." };
  const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
  const up = await uploadEvidence(supabase, r.meeting_id as string, r.id as string, files);
  if ("error" in up) return { error: up.error };
  const { error } = await supabase.rpc("board_report_progress", {
    p_resolution: r.id, p_status: parsed.data.status, p_note: parsed.data.note, p_files: up.files,
  });
  if (error) {
    if (up.files.length) await supabase.storage.from("nil-files").remove(up.files.map((x) => x.storage_path));
    return { error: persianError(error.message) };
  }
  await dispatchBoardNotifications(20);
  revalidatePath(resolutionPath(r.id as string));
  revalidatePath("/board/resolutions");
  return { ok: true, message: "گزارش ثبت شد." };
}

/** Closing (secretary's decision, APPROVE tier) or reopening a resolution — always with a written outcome / reason. */
export async function closeOrReopenResolution(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const parsed = boardCloseSchema.safeParse(entries(f));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase } = await ctx();
  const { error } = parsed.data.action === "close"
    ? await supabase.rpc("board_close_resolution", { p_resolution: parsed.data.resolution_id, p_note: parsed.data.note })
    : await supabase.rpc("board_reopen_resolution", { p_resolution: parsed.data.resolution_id, p_note: parsed.data.note });
  if (error) return { error: persianError(error.message) };
  await dispatchBoardNotifications(20);
  revalidatePath(resolutionPath(parsed.data.resolution_id));
  revalidatePath("/board/resolutions");
  return { ok: true, message: parsed.data.action === "close" ? "مصوبه بسته شد." : "مصوبه بازگشایی شد." };
}

/* ------------------------------- Phase 2: Telegram linking ------------------------------- */

/** One-time link (7 days). The raw token is shown ONCE here and never stored — only its SHA-256 (board_link_tokens). */
export async function issueTelegramLink(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const id = uuid.safeParse(f.get("member_id"));
  if (!id.success) return { error: "ورودی نامعتبر است." };
  const token = generateLinkToken();
  const link = buildLinkUrl(token);
  if (!link) return { error: "نام کاربری ربات هیئت‌مدیره (BOARD_TELEGRAM_BOT_USERNAME) روی سرور تنظیم نشده است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("board_issue_link_token", { p_member: id.data, p_token_hash: hashLinkToken(token) });
  if (error) return { error: persianError(error.message) };
  return { ok: true, link, message: "لینک ساخته شد؛ فقط یک‌بار و تا ۷ روز معتبر است." };
}

export async function unlinkTelegram(_p: BoardActionState, f: FormData): Promise<BoardActionState> {
  const id = uuid.safeParse(f.get("member_id"));
  if (!id.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("board_unlink_telegram", { p_member: id.data });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/board/members");
  return { ok: true, message: "اتصال تلگرام قطع شد." };
}

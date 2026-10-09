import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBoardMinutesPdf } from "@/lib/pdf/boardMinutesData";
import { boardBotConfigured, sendDocument, sendMessage } from "./bot";
import { MAIN_MENU, minutesCaption, notificationText, type MeetingRow, type NotificationKind, type ResRow } from "./messages";

/**
 * Board notifications: drains the board_notifications outbox (0150). Runs as service_role — called by the cron route and, best effort,
 * right after each event (approval, follow-up). Exactly-once is not promised by Telegram; the outbox gives at-most-once per dedupe key
 * plus retries (lease 5 min, max 8 attempts): a crash between "sent" and "marked" can repeat one message, never lose one silently.
 */

type OutboxRow = {
  id: number; member_id: string; kind: NotificationKind; meeting_id: string | null; resolution_id: string | null; payload: Record<string, unknown>;
};

/** The exact verified (frozen) minutes PDF when one exists; otherwise rendered from the approved snapshot. Never a draft. */
export async function minutesPdfForMember(service: SupabaseClient, meetingId: string): Promise<{ buffer: Buffer; fileName: string; meeting: MeetingRow } | null> {
  const { data: m } = await service.from("board_meetings").select("id, meeting_number, scheduled_at, status").eq("id", meetingId).maybeSingle();
  if (!m || m.status !== "APPROVED") return null;
  const meeting = m as MeetingRow & { status: string };
  const fileName = `board-minutes-${meeting.meeting_number}.pdf`;
  const { data: v } = await service
    .from("document_verifications")
    .select("pdf_storage_path, status")
    .eq("document_type", "BOARD_MINUTES")
    .eq("document_id", meetingId)
    .in("status", ["ACTIVE", "REVOKED", "SUPERSEDED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (v?.pdf_storage_path) {
    const { data: file } = await service.storage.from("nil-files").download(v.pdf_storage_path as string);
    if (file) return { buffer: Buffer.from(await file.arrayBuffer()), fileName, meeting };
  }
  const built = await buildBoardMinutesPdf(service, meetingId);
  return { buffer: built.buffer, fileName, meeting };
}

async function deliver(service: SupabaseClient, row: OutboxRow): Promise<string | null> {
  const { data: link } = await service
    .from("board_telegram_links")
    .select("telegram_chat_id, board_members!inner(full_name, is_active)")
    .eq("member_id", row.member_id)
    .maybeSingle();
  const mem = (link as { board_members?: { full_name: string; is_active: boolean } | { full_name: string; is_active: boolean }[] } | null)?.board_members;
  const member = Array.isArray(mem) ? mem[0] : mem;
  if (!link || !member?.is_active) return "NO_LINK";
  const chatId = Number(link.telegram_chat_id);

  if (row.kind === "MINUTES") {
    if (!row.meeting_id) return "NO_MEETING";
    const pdf = await minutesPdfForMember(service, row.meeting_id);
    if (!pdf) return "NO_MINUTES";
    return (await sendDocument(chatId, pdf.buffer, pdf.fileName, notificationText({ kind: "MINUTES", memberName: member.full_name, meeting: pdf.meeting, payload: {} }) ?? minutesCaption(pdf.meeting)))
      ? null : "SEND_FAILED";
  }

  let meeting: MeetingRow | null = null;
  if (row.meeting_id) {
    const { data } = await service.from("board_meetings").select("id, meeting_number, scheduled_at").eq("id", row.meeting_id).maybeSingle();
    meeting = (data as MeetingRow) ?? null;
  }
  let resolution: (ResRow & { owner_name?: string | null }) | null = null;
  let lastNote: string | null = null;
  if (row.resolution_id) {
    const { data } = await service
      .from("board_resolutions")
      .select("id, resolution_number, text, due_date, expected_output, follow_status, owner:board_members!board_resolutions_owner_member_id_fkey(full_name)")
      .eq("id", row.resolution_id)
      .maybeSingle();
    if (data) {
      const o = (data as { owner?: { full_name: string } | { full_name: string }[] | null }).owner;
      resolution = { ...(data as unknown as ResRow), owner_name: (Array.isArray(o) ? o[0] : o)?.full_name ?? null };
    }
    if (row.kind === "REVIEW_REQUEST") {
      const { data: u } = await service.from("board_resolution_updates").select("note").eq("resolution_id", row.resolution_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      lastNote = (u?.note as string) ?? null;
    }
  }
  let resolutions: ResRow[] | undefined;
  if (row.kind === "NEW_RESOLUTIONS" && row.meeting_id) {
    const { data } = await service
      .from("board_resolutions")
      .select("id, resolution_number, text, due_date, expected_output, follow_status")
      .eq("meeting_id", row.meeting_id)
      .eq("owner_member_id", row.member_id)
      .eq("requires_action", true);
    resolutions = ((data ?? []) as ResRow[]).sort((a, b) => (a.resolution_number ?? "").localeCompare(b.resolution_number ?? "", "en", { numeric: true }));
  }
  // a reminder for a resolution that has meanwhile been reported or closed is dropped, not sent
  if (["DUE_SOON", "DUE_TODAY", "OVERDUE"].includes(row.kind) && resolution && !["OPEN", "IN_PROGRESS", "BLOCKED"].includes(resolution.follow_status)) return null;

  const text = notificationText({ kind: row.kind, memberName: member.full_name, meeting, resolution, resolutions, lastNote, payload: row.payload ?? {} });
  if (!text) return null;
  const keyboard = row.kind === "REVIEW_REQUEST" || row.kind === "DIGEST" ? undefined : MAIN_MENU;
  return (await sendMessage(chatId, text, keyboard)) ? null : "SEND_FAILED";
}

/** Sends what is pending. Returns counts; never throws (a notification problem must never fail the business action that queued it). */
export async function dispatchBoardNotifications(limit = 50): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (!boardBotConfigured()) return { sent: 0, failed: 0, skipped: "BOT_NOT_CONFIGURED" };
  let sent = 0;
  let failed = 0;
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("board_claim_notifications", { p_limit: limit });
    if (error) {
      console.error("[board-notify] claim failed", error.message);
      return { sent, failed };
    }
    for (const row of (data ?? []) as OutboxRow[]) {
      let err: string | null;
      try {
        err = await deliver(service, row);
      } catch (e) {
        err = e instanceof Error ? e.message.slice(0, 200) : "DELIVERY_ERROR";
      }
      await service.rpc("board_finish_notification", { p_id: row.id, p_error: err === "NO_LINK" ? null : err });
      if (err && err !== "NO_LINK") failed++;
      else sent++;
    }
  } catch (e) {
    console.error("[board-notify] dispatch failed", e instanceof Error ? e.message : e);
  }
  return { sent, failed };
}

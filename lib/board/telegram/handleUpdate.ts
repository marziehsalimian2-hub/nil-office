import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { checkExternalCorrespondenceSignature, extensionOf, validateExternalCorrespondenceUpload } from "@/lib/upload-validation";
import { persianError } from "@/lib/enums";
import { tehranDate } from "@/lib/board/time";
import { answerCallbackQuery, clearInlineKeyboard, downloadTelegramFile, sendDocument, sendMessage } from "./bot";
import { hashLinkToken, isPrivateChat, parseStartToken } from "./security";
import {
  CANCEL_ROW, MAIN_MENU, NOTES_KB, SUBMIT_KB, T, draftMeetingsKeyboard, menuFor, minutesCaption, minutesKeyboard, myResolutionsKeyboard,
  parseCallback, resolutionActionsKeyboard, resolutionDetailText, type MeetingRow, type ReportStatus, type ResRow,
} from "./messages";
import { dispatchBoardNotifications, minutesPdfForMember } from "./notify";
import { draftMinutesFromNotes, loadDraftContext, MAX_NOTES_CHARS } from "@/lib/board/assistant/draft";

/**
 * Board bot. Zero trust: a chat is served ONLY if its Telegram account is linked to an ACTIVE board member (board_telegram_links, written
 * only by board_consume_link_token with a one-time token). Every callback re-checks ownership; the follow-up RPC re-checks again in the
 * database. Runs as service_role, so every query here is scoped to the linked member explicitly.
 * A member can: list the open resolutions they own, report progress (status + note + PDF/JPG/PNG evidence), and download approved minutes.
 */

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    photo?: { file_id: string; file_size?: number }[];
    voice?: unknown;
    audio?: unknown;
    video_note?: unknown;
  };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number; type: string } } };
};

type Member = { id: string; full_name: string };
type PendingFile = { storage_path: string; file_name: string; mime_type: string; size_bytes: number };
type State = {
  step: "MENU" | "AWAIT_NOTE" | "AWAIT_FILES" | "AWAIT_NOTES";
  data: { resolution_id?: string; status?: ReportStatus; note?: string; files?: PendingFile[]; meeting_id?: string; notes?: string };
};

const MAX_FILES = 5;
const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

async function linkedMember(service: SupabaseClient, telegramUserId: number, chatId: number): Promise<Member | null> {
  const { data } = await service
    .from("board_telegram_links")
    .select("member_id, telegram_chat_id, board_members!inner(id, full_name, is_active)")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (!data || Number(data.telegram_chat_id) !== chatId) return null;
  const raw = (data as { board_members: { id: string; full_name: string; is_active: boolean } | { id: string; full_name: string; is_active: boolean }[] }).board_members;
  const m = Array.isArray(raw) ? raw[0] : raw;
  return m?.is_active ? { id: m.id, full_name: m.full_name } : null;
}

async function getState(service: SupabaseClient, chatId: number): Promise<State> {
  const { data } = await service.from("board_bot_state").select("step, data").eq("telegram_chat_id", chatId).maybeSingle();
  return data ? { step: data.step as State["step"], data: (data.data ?? {}) as State["data"] } : { step: "MENU", data: {} };
}
async function setState(service: SupabaseClient, chatId: number, memberId: string, s: State): Promise<void> {
  await service.from("board_bot_state").upsert({ telegram_chat_id: chatId, member_id: memberId, step: s.step, data: s.data, updated_at: new Date().toISOString() });
}
async function clearState(service: SupabaseClient, chatId: number, removeFiles = false): Promise<void> {
  if (removeFiles) {
    const s = await getState(service, chatId);
    const paths = (s.data.files ?? []).map((f) => f.storage_path);
    if (paths.length) await service.storage.from("nil-files").remove(paths);
  }
  await service.from("board_bot_state").delete().eq("telegram_chat_id", chatId);
}

/** An open action resolution of an APPROVED meeting that this member owns, or null. */
async function ownedOpenResolution(service: SupabaseClient, memberId: string, id: string): Promise<(ResRow & { meeting_id: string }) | null> {
  const { data } = await service
    .from("board_resolutions")
    .select("id, meeting_id, resolution_number, text, due_date, expected_output, follow_status, requires_action, owner_member_id, board_meetings!inner(status)")
    .eq("id", id)
    .eq("owner_member_id", memberId)
    .eq("requires_action", true)
    .eq("board_meetings.status", "APPROVED")
    .maybeSingle();
  if (!data || data.follow_status === "DONE") return null;
  return data as unknown as ResRow & { meeting_id: string };
}

/** The profile a member drafts as (Phase 3): linked to a NIL Office profile holding the board CREATE tier — else null. */
async function drafterProfile(service: SupabaseClient, memberId: string): Promise<string | null> {
  const { data, error } = await service.rpc("board_member_drafter_profile", { p_member: memberId });
  if (error) return null;
  return (data as string | null) ?? null;
}

async function showMenu(chatId: number, prefix?: string, ctx?: { service: SupabaseClient; member: Member }) {
  const canDraft = ctx ? !!(await drafterProfile(ctx.service, ctx.member.id)) : false;
  await sendMessage(chatId, prefix ? `${prefix}\n\n${T.menu}` : T.menu, canDraft ? menuFor(true) : MAIN_MENU);
}

export async function handleBoardTelegramUpdate(update: TgUpdate): Promise<void> {
  const service = createServiceClient();
  if (update.callback_query) return handleCallback(service, update.callback_query);
  if (update.message) return handleMessage(service, update.message);
}

async function handleMessage(service: SupabaseClient, msg: NonNullable<TgUpdate["message"]>): Promise<void> {
  if (!isPrivateChat(msg.chat.type) || !msg.from?.id) return;
  const chatId = msg.chat.id;

  // linking: «/start <one-time token>»
  const token = parseStartToken(msg.text);
  if (token) {
    const { data, error } = await service.rpc("board_consume_link_token", { p_token_hash: hashLinkToken(token), p_telegram_user: msg.from.id, p_telegram_chat: chatId });
    const r = data as { ok: boolean; reason?: string; name?: string } | null;
    if (error || !r?.ok) return void (await sendMessage(chatId, r?.reason === "ACCOUNT_IN_USE" ? T.linkInUse : T.linkInvalid));
    await clearState(service, chatId);
    const linked = await linkedMember(service, msg.from.id, chatId);
    return showMenu(chatId, T.linked(r.name ?? ""), linked ? { service, member: linked } : undefined);
  }

  const member = await linkedMember(service, msg.from.id, chatId);
  if (!member) return void (await sendMessage(chatId, T.notLinked));

  const text = (msg.text ?? "").trim();
  if (text === "/start" || text === "/menu") {
    await clearState(service, chatId, true);
    return showMenu(chatId, undefined, { service, member });
  }
  if (msg.voice || msg.audio || msg.video_note) return void (await sendMessage(chatId, T.voiceRejected));

  const state = await getState(service, chatId);
  if (state.step === "AWAIT_NOTES") {
    if (!text || text.startsWith("/")) return void (await sendMessage(chatId, T.notesEmpty, NOTES_KB));
    const notes = state.data.notes ? `${state.data.notes}\n${text}` : text;
    if (notes.length > MAX_NOTES_CHARS) return void (await sendMessage(chatId, T.notesTooLong, NOTES_KB));
    await setState(service, chatId, member.id, { step: "AWAIT_NOTES", data: { ...state.data, notes } });
    return void (await sendMessage(chatId, T.notesReceived(notes.length), NOTES_KB));
  }
  if (state.step === "AWAIT_NOTE") {
    if (!text || text.startsWith("/")) return void (await sendMessage(chatId, T.noteEmpty, [CANCEL_ROW]));
    await setState(service, chatId, member.id, { step: "AWAIT_FILES", data: { ...state.data, note: text.slice(0, 4000), files: [] } });
    return void (await sendMessage(chatId, T.askFiles, SUBMIT_KB));
  }
  if (state.step === "AWAIT_FILES" && (msg.document || msg.photo?.length)) {
    return receiveFile(service, chatId, member, state, msg);
  }
  if (state.step === "AWAIT_FILES") return void (await sendMessage(chatId, T.askFiles, SUBMIT_KB));
  return showMenu(chatId, undefined, { service, member });
}

async function receiveFile(service: SupabaseClient, chatId: number, member: Member, state: State, msg: NonNullable<TgUpdate["message"]>): Promise<void> {
  const files = state.data.files ?? [];
  if (files.length >= MAX_FILES) return void (await sendMessage(chatId, T.tooManyFiles, SUBMIT_KB));
  const res = state.data.resolution_id ? await ownedOpenResolution(service, member.id, state.data.resolution_id) : null;
  if (!res) {
    await clearState(service, chatId, true);
    return showMenu(chatId, T.notAllowed, { service, member });
  }

  // photos arrive as JPEG renditions (largest = last); documents keep their own name
  const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  const fileId = msg.document?.file_id ?? photo?.file_id;
  const name = msg.document ? (msg.document.file_name ?? "file") : `photo-${files.length + 1}.jpg`;
  const declaredMime = msg.document ? msg.document.mime_type : "image/jpeg";
  const declaredSize = msg.document?.file_size ?? photo?.file_size ?? 1;
  const check = validateExternalCorrespondenceUpload(name, declaredMime, declaredSize);
  if (!check.ok) return void (await sendMessage(chatId, check.error, SUBMIT_KB));
  if (!fileId) return void (await sendMessage(chatId, T.fileFailed, SUBMIT_KB));

  const bytes = await downloadTelegramFile(fileId);
  const ext = extensionOf(name)!;
  if (!bytes) return void (await sendMessage(chatId, T.fileFailed, SUBMIT_KB));
  const real = validateExternalCorrespondenceUpload(name, declaredMime, bytes.length);
  if (!real.ok) return void (await sendMessage(chatId, real.error, SUBMIT_KB));
  if (!checkExternalCorrespondenceSignature(ext, new Uint8Array(bytes.subarray(0, 16)))) {
    return void (await sendMessage(chatId, "محتوای فایل با پسوند آن هم‌خوان نیست.", SUBMIT_KB));
  }

  const path = `board_meeting/${res.meeting_id}/followup/${res.id}/${randomUUID()}.${ext}`;
  const { error } = await service.storage.from("nil-files").upload(path, bytes, { contentType: MIME[ext], upsert: false });
  if (error) {
    console.error("[board-telegram] evidence upload failed", error.message);
    return void (await sendMessage(chatId, T.fileFailed, SUBMIT_KB));
  }
  const safeName = name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || `file.${ext}`;
  const next = [...files, { storage_path: path, file_name: safeName, mime_type: MIME[ext], size_bytes: bytes.length }];
  await setState(service, chatId, member.id, { step: "AWAIT_FILES", data: { ...state.data, files: next } });
  await sendMessage(chatId, T.fileReceived(next.length), SUBMIT_KB);
}

async function handleCallback(service: SupabaseClient, cq: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const chat = cq.message?.chat;
  await answerCallbackQuery(cq.id);
  if (!chat || !isPrivateChat(chat.type)) return;
  const chatId = chat.id;
  const member = await linkedMember(service, cq.from.id, chatId);
  if (!member) return void (await sendMessage(chatId, T.notLinked));
  if (cq.message) await clearInlineKeyboard(chatId, cq.message.message_id);

  const c = parseCallback(cq.data);
  const mctx = { service, member };
  if (!c) return showMenu(chatId, undefined, mctx);
  const today = tehranDate(new Date())!;

  switch (c.t) {
    case "menu":
      await clearState(service, chatId, true);
      return showMenu(chatId, undefined, mctx);
    case "help":
      return void (await sendMessage(chatId, T.help, MAIN_MENU));
    case "cancel":
      await clearState(service, chatId, true);
      return showMenu(chatId, T.cancelled, mctx);
    case "my": {
      await clearState(service, chatId, true);
      const { data } = await service
        .from("board_resolutions")
        .select("id, resolution_number, text, due_date, expected_output, follow_status, board_meetings!inner(status)")
        .eq("owner_member_id", member.id)
        .eq("requires_action", true)
        .neq("follow_status", "DONE")
        .eq("board_meetings.status", "APPROVED")
        .order("due_date")
        .limit(25);
      const rows = (data ?? []) as unknown as ResRow[];
      if (!rows.length) return void (await sendMessage(chatId, T.noOpen, MAIN_MENU));
      return void (await sendMessage(chatId, "مصوبات باز شما (به ترتیب مهلت):", myResolutionsKeyboard(rows)));
    }
    case "res": {
      const r = await ownedOpenResolution(service, member.id, c.id);
      if (!r) return showMenu(chatId, T.notAllowed, mctx);
      const { data: u } = await service.from("board_resolution_updates").select("note").eq("resolution_id", r.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return void (await sendMessage(chatId, resolutionDetailText(r, today, (u?.note as string) ?? null), resolutionActionsKeyboard(r.id)));
    }
    case "st": {
      const r = await ownedOpenResolution(service, member.id, c.id);
      if (!r) return showMenu(chatId, T.notAllowed, mctx);
      await clearState(service, chatId, true);
      await setState(service, chatId, member.id, { step: "AWAIT_NOTE", data: { resolution_id: r.id, status: c.status } });
      return void (await sendMessage(chatId, T.askNote, [CANCEL_ROW]));
    }
    case "submit": {
      const state = await getState(service, chatId);
      const { resolution_id, status, note, files } = state.data;
      if (state.step !== "AWAIT_FILES" || !resolution_id || !status || !note) return showMenu(chatId, undefined, mctx);
      const { error } = await service.rpc("board_member_report_progress", {
        p_member: member.id, p_resolution: resolution_id, p_status: status, p_note: note, p_files: files ?? [],
      });
      if (error) {
        console.error("[board-telegram] report failed", error.message);
        await clearState(service, chatId, true);
        return showMenu(chatId, persianError(error.message), mctx);
      }
      await clearState(service, chatId);                 // files are now registered: keep them
      await showMenu(chatId, status === "PENDING_REVIEW" ? T.submitted : T.submittedProgress, mctx);
      await dispatchBoardNotifications(20);
      return;
    }
    case "mins": {
      const { data } = await service
        .from("board_meetings")
        .select("id, meeting_number, scheduled_at")
        .eq("status", "APPROVED")
        .order("meeting_number", { ascending: false })
        .limit(8);
      const rows = (data ?? []) as MeetingRow[];
      if (!rows.length) return void (await sendMessage(chatId, T.noMinutes, MAIN_MENU));
      return void (await sendMessage(chatId, "کدام صورت‌جلسه؟", minutesKeyboard(rows)));
    }
    case "min": {
      await sendMessage(chatId, T.sendingPdf);
      const pdf = await minutesPdfForMember(service, c.id).catch(() => null);
      if (!pdf || !(await sendDocument(chatId, pdf.buffer, pdf.fileName, minutesCaption(pdf.meeting)))) {
        return showMenu(chatId, T.pdfFailed, mctx);
      }
      return showMenu(chatId, undefined, mctx);
    }
    case "notes": {
      if (!(await drafterProfile(service, member.id))) return showMenu(chatId, T.notDrafter, mctx);
      await clearState(service, chatId, true);
      const { data } = await service.from("board_meetings").select("id, scheduled_at").eq("status", "DRAFT").order("scheduled_at").limit(6);
      const rows = (data ?? []) as { id: string; scheduled_at: string }[];
      if (!rows.length) return showMenu(chatId, T.noDraftMeetings, mctx);
      return void (await sendMessage(chatId, T.notesPickMeeting, draftMeetingsKeyboard(rows)));
    }
    case "nt": {
      if (!(await drafterProfile(service, member.id))) return showMenu(chatId, T.notDrafter, mctx);
      const { data: m } = await service.from("board_meetings").select("id").eq("id", c.id).eq("status", "DRAFT").maybeSingle();
      if (!m) return showMenu(chatId, T.noDraftMeetings, mctx);
      await setState(service, chatId, member.id, { step: "AWAIT_NOTES", data: { meeting_id: c.id, notes: "" } });
      return void (await sendMessage(chatId, T.notesStart, [CANCEL_ROW]));
    }
    case "mk": {
      const profileId = await drafterProfile(service, member.id);
      if (!profileId) return showMenu(chatId, T.notDrafter, mctx);
      const state = await getState(service, chatId);
      const notes = (state.data.notes ?? "").trim();
      if (state.step !== "AWAIT_NOTES" || !state.data.meeting_id) return showMenu(chatId, undefined, mctx);
      if (!notes) return void (await sendMessage(chatId, T.notesEmpty, NOTES_KB));
      const context = await loadDraftContext(service, state.data.meeting_id);
      if (!context || context.status !== "DRAFT") {
        await clearState(service, chatId);
        return showMenu(chatId, T.noDraftMeetings, mctx);
      }
      await sendMessage(chatId, T.drafting);
      const r = await draftMinutesFromNotes({ notes, ctx: context, usageClient: service, profileId, channel: "TELEGRAM" });
      if (!r.ok) return void (await sendMessage(chatId, r.error, NOTES_KB));   // notes kept: the secretary can retry or add more
      const { error } = await service.from("board_ai_drafts").insert({
        meeting_id: state.data.meeting_id, source: "TELEGRAM", notes, suggestion: r.suggestion, model: r.model,
        input_tokens: r.inputTokens, output_tokens: r.outputTokens, created_by: profileId, created_by_member: member.id,
      });
      if (error) {
        console.error("[board-telegram] storing the draft failed", error.message);
        return void (await sendMessage(chatId, T.error, NOTES_KB));
      }
      await clearState(service, chatId);
      const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const url = /^https:\/\/[^/]+$/.test(base) ? `${base}/board/meetings/${state.data.meeting_id}` : null;
      return showMenu(chatId, T.draftReady(r.suggestion.agenda.length, r.suggestion.resolutions.length, r.suggestion.warnings.length, url), mctx);
    }
  }
}

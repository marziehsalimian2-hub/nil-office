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
  CANCEL_ROW, MAIN_MENU, SUBMIT_KB, T, minutesCaption, minutesKeyboard, myResolutionsKeyboard, parseCallback, resolutionActionsKeyboard,
  resolutionDetailText, type MeetingRow, type ReportStatus, type ResRow,
} from "./messages";
import { dispatchBoardNotifications, minutesPdfForMember } from "./notify";

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
  };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number; type: string } } };
};

type Member = { id: string; full_name: string };
type PendingFile = { storage_path: string; file_name: string; mime_type: string; size_bytes: number };
type State = { step: "MENU" | "AWAIT_NOTE" | "AWAIT_FILES"; data: { resolution_id?: string; status?: ReportStatus; note?: string; files?: PendingFile[] } };

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

async function showMenu(chatId: number, prefix?: string) {
  await sendMessage(chatId, prefix ? `${prefix}\n\n${T.menu}` : T.menu, MAIN_MENU);
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
    return showMenu(chatId, T.linked(r.name ?? ""));
  }

  const member = await linkedMember(service, msg.from.id, chatId);
  if (!member) return void (await sendMessage(chatId, T.notLinked));

  const text = (msg.text ?? "").trim();
  if (text === "/start" || text === "/menu") {
    await clearState(service, chatId, true);
    return showMenu(chatId);
  }

  const state = await getState(service, chatId);
  if (state.step === "AWAIT_NOTE") {
    if (!text || text.startsWith("/")) return void (await sendMessage(chatId, T.noteEmpty, [CANCEL_ROW]));
    await setState(service, chatId, member.id, { step: "AWAIT_FILES", data: { ...state.data, note: text.slice(0, 4000), files: [] } });
    return void (await sendMessage(chatId, T.askFiles, SUBMIT_KB));
  }
  if (state.step === "AWAIT_FILES" && (msg.document || msg.photo?.length)) {
    return receiveFile(service, chatId, member, state, msg);
  }
  if (state.step === "AWAIT_FILES") return void (await sendMessage(chatId, T.askFiles, SUBMIT_KB));
  return showMenu(chatId);
}

async function receiveFile(service: SupabaseClient, chatId: number, member: Member, state: State, msg: NonNullable<TgUpdate["message"]>): Promise<void> {
  const files = state.data.files ?? [];
  if (files.length >= MAX_FILES) return void (await sendMessage(chatId, T.tooManyFiles, SUBMIT_KB));
  const res = state.data.resolution_id ? await ownedOpenResolution(service, member.id, state.data.resolution_id) : null;
  if (!res) {
    await clearState(service, chatId, true);
    return showMenu(chatId, T.notAllowed);
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
  if (!c) return showMenu(chatId);
  const today = tehranDate(new Date())!;

  switch (c.t) {
    case "menu":
      await clearState(service, chatId, true);
      return showMenu(chatId);
    case "help":
      return void (await sendMessage(chatId, T.help, MAIN_MENU));
    case "cancel":
      await clearState(service, chatId, true);
      return showMenu(chatId, T.cancelled);
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
      if (!r) return showMenu(chatId, T.notAllowed);
      const { data: u } = await service.from("board_resolution_updates").select("note").eq("resolution_id", r.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return void (await sendMessage(chatId, resolutionDetailText(r, today, (u?.note as string) ?? null), resolutionActionsKeyboard(r.id)));
    }
    case "st": {
      const r = await ownedOpenResolution(service, member.id, c.id);
      if (!r) return showMenu(chatId, T.notAllowed);
      await clearState(service, chatId, true);
      await setState(service, chatId, member.id, { step: "AWAIT_NOTE", data: { resolution_id: r.id, status: c.status } });
      return void (await sendMessage(chatId, T.askNote, [CANCEL_ROW]));
    }
    case "submit": {
      const state = await getState(service, chatId);
      const { resolution_id, status, note, files } = state.data;
      if (state.step !== "AWAIT_FILES" || !resolution_id || !status || !note) return showMenu(chatId);
      const { error } = await service.rpc("board_member_report_progress", {
        p_member: member.id, p_resolution: resolution_id, p_status: status, p_note: note, p_files: files ?? [],
      });
      if (error) {
        console.error("[board-telegram] report failed", error.message);
        await clearState(service, chatId, true);
        return showMenu(chatId, persianError(error.message));
      }
      await clearState(service, chatId);                 // files are now registered: keep them
      await showMenu(chatId, status === "PENDING_REVIEW" ? T.submitted : T.submittedProgress);
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
        return showMenu(chatId, T.pdfFailed);
      }
      return showMenu(chatId);
    }
  }
}

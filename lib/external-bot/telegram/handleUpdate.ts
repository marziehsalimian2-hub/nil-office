import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { isPrivateChat } from "./security";
import { sendMessage, answerCallbackQuery, clearInlineKeyboard, getFileDownloadUrl, type InlineKeyboardButton } from "./bot";
import { generateTrackingCode, generateExternalDocumentId } from "@/lib/external-correspondence/tracking-code";
import { validateExternalCorrespondenceUpload, checkExternalCorrespondenceSignature, extensionOf, MAX_EXTERNAL_CORRESPONDENCE_UPLOAD_BYTES } from "@/lib/upload-validation";
import { EXTERNAL_INTAKE_PUBLIC_STATUS_LABEL, EXTERNAL_SENDER_TYPE_LABEL, type ExternalIntakeStatus } from "@/lib/enums";

// Minimal shape of what this handler actually reads — not the full Telegram Update schema.
type TelegramUpdate = {
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

type DraftDocument = { document_id: string; storage_path: string; file_name_sanitized: string; declared_mime: string; size_bytes: number };
type DraftData = {
  intake_id?: string;
  sender_type?: "INDIVIDUAL" | "ORGANIZATION";
  sender_full_name?: string;
  sender_org_name_raw?: string;
  sender_position?: string;
  sender_mobile?: string;
  sender_email?: string;
  subject?: string;
  description?: string;
  documents?: DraftDocument[];
  tracking_code?: string; // used transiently by the "add information" flow
};

const WELCOME_TEXT = `سامانه دریافت مکاتبات
شرکت توسعه مدیریت راهبردی نیل

از طریق این سامانه می‌توانید نامه‌ها و مکاتبات خود را برای شرکت ارسال کرده و وضعیت آنها را پیگیری نمایید.`;

const MAIN_MENU: InlineKeyboardButton[][] = [
  [{ text: "ارسال مکاتبه جدید", callback_data: "menu:new" }],
  [{ text: "پیگیری مکاتبه", callback_data: "menu:track" }],
  [{ text: "راهنما", callback_data: "menu:help" }],
  [{ text: "اطلاعات تماس", callback_data: "menu:contact" }],
];

const PRIVACY_NOTICE =
  "اطلاعات ارسالی شما فقط برای ثبت، بررسی و پاسخ به این مکاتبه توسط شرکت توسعه مدیریت راهبردی نیل نگهداری و پردازش می‌شود.";
const HELP_TEXT =
  "برای ارسال یک مکاتبهٔ جدید، «ارسال مکاتبه جدید» را بزنید و مراحل را دنبال کنید. برای پیگیری وضعیت یک مکاتبهٔ قبلی، «پیگیری مکاتبه» را بزنید یا کد رهگیری خود را مستقیماً برای من ارسال کنید.";
const CONTACT_TEXT = "برای ارتباط مستقیم، لطفاً از راه‌های ارتباطی رسمی شرکت توسعه مدیریت راهبردی نیل استفاده کنید.";
const GENERIC_ERROR_TEXT = "در ثبت درخواست مشکلی رخ داد. لطفاً مجدداً تلاش کنید.";

// ---------------------------------------------------------------------
// Conversation state helpers — external_bot_conversation_state, pure UI
// bookkeeping, upserted per message and cleared on confirm/cancel/menu.
// ---------------------------------------------------------------------
async function getState(service: SupabaseClient, chatId: number): Promise<{ step: string; data: DraftData } | null> {
  const { data } = await service.from("external_bot_conversation_state").select("step, data").eq("telegram_chat_id", chatId).maybeSingle();
  if (!data) return null;
  return { step: data.step as string, data: (data.data ?? {}) as DraftData };
}

async function setState(service: SupabaseClient, chatId: number, telegramUserId: number, step: string, data: DraftData): Promise<void> {
  await service.from("external_bot_conversation_state").upsert({
    telegram_chat_id: chatId,
    telegram_user_id: telegramUserId,
    step,
    data,
    updated_at: new Date().toISOString(),
  });
}

async function clearState(service: SupabaseClient, chatId: number): Promise<void> {
  await service.from("external_bot_conversation_state").delete().eq("telegram_chat_id", chatId);
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------
export async function handleExternalTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
  }
}

async function handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  if (!isPrivateChat(msg.chat.type)) return; // group/channel spam ignored entirely
  const telegramUserId = msg.from?.id;
  if (!telegramUserId) return;
  const chatId = msg.chat.id;
  const service = createServiceClient();

  if (msg.text?.trim() === "/start") {
    await clearState(service, chatId);
    await sendMessage(chatId, WELCOME_TEXT);
    await sendMessage(chatId, "لطفاً یکی از گزینه‌های زیر را انتخاب کنید:", MAIN_MENU);
    return;
  }

  const state = await getState(service, chatId);
  const step = state?.step ?? "MENU";
  const data = state?.data ?? {};

  try {
    switch (step) {
      case "SENDER_ORG_NAME": {
        const orgName = (msg.text ?? "").trim();
        if (!orgName) return void (await sendMessage(chatId, "لطفاً نام سازمان را وارد کنید."));
        data.sender_org_name_raw = orgName;
        await setState(service, chatId, telegramUserId, "SENDER_NAME", data);
        await sendMessage(chatId, "نام و نام خانوادگی نمایندهٔ ارسال‌کننده را وارد کنید:");
        return;
      }
      case "SENDER_NAME": {
        const name = (msg.text ?? "").trim();
        if (!name) return void (await sendMessage(chatId, "لطفاً نام و نام خانوادگی را وارد کنید."));
        data.sender_full_name = name;
        if (data.sender_type === "ORGANIZATION") {
          await setState(service, chatId, telegramUserId, "SENDER_POSITION", data);
          await sendMessage(chatId, "سمت/عنوان شغلی نمایندهٔ ارسال‌کننده را وارد کنید (اختیاری):", [[{ text: "رد کردن", callback_data: "skip:position" }]]);
        } else {
          await setState(service, chatId, telegramUserId, "SENDER_MOBILE", data);
          await sendMessage(chatId, "شمارهٔ موبایل (اختیاری):", [[{ text: "رد کردن", callback_data: "skip:mobile" }]]);
        }
        return;
      }
      case "SENDER_POSITION": {
        data.sender_position = (msg.text ?? "").trim() || undefined;
        await setState(service, chatId, telegramUserId, "SENDER_MOBILE", data);
        await sendMessage(chatId, "شمارهٔ موبایل (اختیاری):", [[{ text: "رد کردن", callback_data: "skip:mobile" }]]);
        return;
      }
      case "SENDER_MOBILE": {
        data.sender_mobile = (msg.text ?? "").trim() || undefined;
        await setState(service, chatId, telegramUserId, "SENDER_EMAIL", data);
        await sendMessage(chatId, "ایمیل (اختیاری):", [[{ text: "رد کردن", callback_data: "skip:email" }]]);
        return;
      }
      case "SENDER_EMAIL": {
        data.sender_email = (msg.text ?? "").trim() || undefined;
        await setState(service, chatId, telegramUserId, "SUBJECT", data);
        await sendMessage(chatId, PRIVACY_NOTICE);
        await sendMessage(chatId, "موضوع مکاتبه را وارد کنید (مثلاً «درخواست همکاری»):");
        return;
      }
      case "SUBJECT": {
        const subject = (msg.text ?? "").trim();
        if (!subject) return void (await sendMessage(chatId, "لطفاً موضوع مکاتبه را وارد کنید."));
        data.subject = subject;
        await setState(service, chatId, telegramUserId, "DESCRIPTION", data);
        await sendMessage(chatId, "شرح یا توضیح مکاتبه را وارد کنید:");
        return;
      }
      case "DESCRIPTION": {
        const description = (msg.text ?? "").trim();
        if (!description) return void (await sendMessage(chatId, "لطفاً شرح مکاتبه را وارد کنید."));
        data.description = description;
        data.intake_id = data.intake_id ?? randomUUID();
        await setState(service, chatId, telegramUserId, "UPLOAD", data);
        await sendMessage(
          chatId,
          "در صورت تمایل، مدرک یا فایل خود را ارسال کنید (PDF، JPG یا PNG، حداکثر ۱۰ مگابایت). وقتی کارتان تمام شد، روی «ادامه» بزنید.",
          [[{ text: "ادامه (بدون مدرک بیشتر)", callback_data: "upload:done" }]],
        );
        return;
      }
      case "UPLOAD": {
        const uploaded = await tryHandleUpload(service, msg, telegramUserId, data);
        if (uploaded === "no-file") {
          await sendMessage(chatId, "برای ادامه، فایلی ارسال کنید یا روی «ادامه» بزنید.", [
            [{ text: "ادامه (بدون مدرک بیشتر)", callback_data: "upload:done" }],
          ]);
          return;
        }
        await setState(service, chatId, telegramUserId, "UPLOAD", data);
        if (uploaded === "ok") {
          await sendMessage(chatId, "فایل دریافت شد. می‌توانید فایل دیگری ارسال کنید یا روی «ادامه» بزنید.", [
            [{ text: "ادامه", callback_data: "upload:done" }],
          ]);
        } else {
          await sendMessage(chatId, uploaded, [[{ text: "ادامه", callback_data: "upload:done" }]]);
        }
        return;
      }
      case "TRACK_WAITING_CODE": {
        await clearState(service, chatId);
        await showTrackingStatus(service, chatId, telegramUserId, (msg.text ?? "").trim());
        return;
      }
      case "ADD_INFO_WAITING_TEXT": {
        const text = (msg.text ?? "").trim();
        if (!text) return void (await sendMessage(chatId, "لطفاً متن اطلاعات تکمیلی را وارد کنید."));
        const trackingCode = data.tracking_code!;
        await clearState(service, chatId);
        const { error } = await service.rpc("external_intake_add_information", {
          p_tracking_code: trackingCode,
          p_telegram_user_id: telegramUserId,
          p_text: text,
        });
        if (error) {
          await sendMessage(chatId, GENERIC_ERROR_TEXT, MAIN_MENU);
          return;
        }
        await sendMessage(chatId, "اطلاعات تکمیلی شما ثبت شد و برای بررسی ارسال شد. متشکریم.", MAIN_MENU);
        return;
      }
      default: {
        // Plain text with no active flow — treat it as a tracking-code lookup attempt (spec §31 supports typing a code directly), else nudge to the menu.
        const maybeCode = (msg.text ?? "").trim();
        if (maybeCode.toUpperCase().startsWith("NIL-T-")) {
          await showTrackingStatus(service, chatId, telegramUserId, maybeCode);
          return;
        }
        await sendMessage(chatId, "لطفاً از منوی زیر یکی از گزینه‌ها را انتخاب کنید:", MAIN_MENU);
        return;
      }
    }
  } catch (err) {
    console.error("[external-telegram] handleMessage failed", err);
    await sendMessage(chatId, GENERIC_ERROR_TEXT, MAIN_MENU);
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  if (!cb.message || !isPrivateChat(cb.message.chat.type) || !cb.data) {
    await answerCallbackQuery(cb.id);
    return;
  }
  const chatId = cb.message.chat.id;
  const telegramUserId = cb.from.id;
  const service = createServiceClient();
  await answerCallbackQuery(cb.id);
  await clearInlineKeyboard(chatId, cb.message.message_id);

  try {
    if (cb.data === "menu:new") {
      await setState(service, chatId, telegramUserId, "SENDER_TYPE", {});
      await sendMessage(chatId, "این مکاتبه از طرف چه شخص یا مجموعه‌ای ارسال می‌شود؟", [
        [{ text: "شخص حقیقی", callback_data: "sender:INDIVIDUAL" }],
        [{ text: "شرکت یا سازمان", callback_data: "sender:ORGANIZATION" }],
      ]);
      return;
    }
    if (cb.data === "menu:help") return void (await sendMessage(chatId, HELP_TEXT, MAIN_MENU));
    if (cb.data === "menu:contact") return void (await sendMessage(chatId, CONTACT_TEXT, MAIN_MENU));
    if (cb.data === "menu:track") {
      await clearState(service, chatId);
      await sendMessage(chatId, "چگونه می‌خواهید مکاتبهٔ خود را پیگیری کنید؟", [
        [{ text: "مشاهدهٔ مکاتبات من", callback_data: "track:mine" }],
        [{ text: "وارد کردن کد رهگیری", callback_data: "track:code" }],
      ]);
      return;
    }
    if (cb.data === "track:mine") {
      await showMySubmissions(service, chatId, telegramUserId);
      return;
    }
    if (cb.data === "track:code") {
      await setState(service, chatId, telegramUserId, "TRACK_WAITING_CODE", {});
      await sendMessage(chatId, "کد رهگیری خود را وارد کنید (مثال: NIL-T-XXXXXXXXXX):");
      return;
    }
    if (cb.data.startsWith("track:show:")) {
      const trackingCode = cb.data.slice("track:show:".length);
      await showTrackingStatus(service, chatId, telegramUserId, trackingCode);
      return;
    }
    if (cb.data.startsWith("addinfo:")) {
      const trackingCode = cb.data.slice("addinfo:".length);
      await setState(service, chatId, telegramUserId, "ADD_INFO_WAITING_TEXT", { tracking_code: trackingCode });
      await sendMessage(chatId, "اطلاعات یا توضیح تکمیلی خود را وارد کنید:");
      return;
    }

    const state = await getState(service, chatId);
    const data = state?.data ?? {};

    if (cb.data === "sender:INDIVIDUAL" || cb.data === "sender:ORGANIZATION") {
      data.sender_type = cb.data === "sender:INDIVIDUAL" ? "INDIVIDUAL" : "ORGANIZATION";
      if (data.sender_type === "ORGANIZATION") {
        await setState(service, chatId, telegramUserId, "SENDER_ORG_NAME", data);
        await sendMessage(chatId, "نام سازمان یا شرکت را وارد کنید:");
      } else {
        await setState(service, chatId, telegramUserId, "SENDER_NAME", data);
        await sendMessage(chatId, "نام و نام خانوادگی خود را وارد کنید:");
      }
      return;
    }
    if (cb.data === "skip:position") {
      await setState(service, chatId, telegramUserId, "SENDER_MOBILE", data);
      await sendMessage(chatId, "شمارهٔ موبایل (اختیاری):", [[{ text: "رد کردن", callback_data: "skip:mobile" }]]);
      return;
    }
    if (cb.data === "skip:mobile") {
      await setState(service, chatId, telegramUserId, "SENDER_EMAIL", data);
      await sendMessage(chatId, "ایمیل (اختیاری):", [[{ text: "رد کردن", callback_data: "skip:email" }]]);
      return;
    }
    if (cb.data === "skip:email") {
      await setState(service, chatId, telegramUserId, "SUBJECT", data);
      await sendMessage(chatId, PRIVACY_NOTICE);
      await sendMessage(chatId, "موضوع مکاتبه را وارد کنید (مثلاً «درخواست همکاری»):");
      return;
    }
    if (cb.data === "upload:done") {
      await setState(service, chatId, telegramUserId, "PREVIEW", data);
      await sendMessage(chatId, buildPreviewText(data), [
        [{ text: "تأیید و ارسال", callback_data: "confirm:submit" }],
        [{ text: "انصراف", callback_data: "confirm:cancel" }],
      ]);
      return;
    }
    if (cb.data === "confirm:cancel") {
      await clearState(service, chatId);
      await sendMessage(chatId, "درخواست شما لغو شد.", MAIN_MENU);
      return;
    }
    if (cb.data === "confirm:submit") {
      await submitIntake(service, chatId, telegramUserId, data);
      return;
    }
  } catch (err) {
    console.error("[external-telegram] handleCallbackQuery failed", err);
    await sendMessage(chatId, GENERIC_ERROR_TEXT, MAIN_MENU);
  }
}

// ---------------------------------------------------------------------
// Upload handling — download from Telegram, validate (spec §11),
// upload to the private nil-files bucket at a deterministic path keyed
// by the pre-generated intake_id, stage the metadata in conversation
// state. Actual DB rows (external_intake_documents) are only written
// once the real external_intakes row exists (submitIntake below).
// ---------------------------------------------------------------------
async function tryHandleUpload(
  service: SupabaseClient,
  msg: NonNullable<TelegramUpdate["message"]>,
  telegramUserId: number,
  data: DraftData,
): Promise<"ok" | "no-file" | string> {
  let fileId: string | null = null;
  let fileName = "";
  let declaredMime = "";

  if (msg.document) {
    fileId = msg.document.file_id;
    fileName = msg.document.file_name || "document";
    declaredMime = msg.document.mime_type || "";
    if ((msg.document.file_size ?? 0) > MAX_EXTERNAL_CORRESPONDENCE_UPLOAD_BYTES) {
      return "حجم فایل بیش از حد مجاز (۱۰ مگابایت) است.";
    }
  } else if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    fileId = largest.file_id;
    fileName = `photo-${Date.now()}.jpg`;
    declaredMime = "image/jpeg";
  } else {
    return "no-file";
  }

  const check = validateExternalCorrespondenceUpload(fileName, declaredMime, msg.document?.file_size ?? MAX_EXTERNAL_CORRESPONDENCE_UPLOAD_BYTES);
  if (!check.ok) return check.error;

  const url = await getFileDownloadUrl(fileId);
  if (!url) return GENERIC_ERROR_TEXT;
  const res = await fetch(url);
  if (!res.ok) return GENERIC_ERROR_TEXT;
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_EXTERNAL_CORRESPONDENCE_UPLOAD_BYTES) return "حجم فایل بیش از حد مجاز (۱۰ مگابایت) است.";
  const bytes = new Uint8Array(arrayBuffer);

  const ext = extensionOf(fileName);
  if (!ext || !checkExternalCorrespondenceSignature(ext, bytes)) {
    return "نوع فایل با محتوای واقعی آن هم‌خوانی ندارد. لطفاً فایل معتبر ارسال کنید.";
  }

  const safeName = fileName.replace(/[^\w.\-() ]+/g, "_");
  const documentId = generateExternalDocumentId();
  const intakeId = data.intake_id!;
  const storagePath = `external-correspondence/${intakeId}/${documentId}/${safeName}`;

  const { error: uploadErr } = await service.storage.from("nil-files").upload(storagePath, Buffer.from(bytes), {
    contentType: declaredMime || `application/octet-stream`,
    upsert: false,
  });
  if (uploadErr) {
    console.error("[external-telegram] storage upload failed", uploadErr);
    return GENERIC_ERROR_TEXT;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  data.documents = data.documents ?? [];
  data.documents.push({
    document_id: documentId,
    storage_path: storagePath,
    file_name_sanitized: safeName,
    declared_mime: declaredMime || "application/octet-stream",
    size_bytes: bytes.byteLength,
  });
  // sha256 is recorded at submit time via external_intake_record_document — stash it alongside for that call.
  (data.documents[data.documents.length - 1] as DraftDocument & { sha256_hash?: string }).sha256_hash = sha256;

  return "ok";
}

function buildPreviewText(data: DraftData): string {
  const lines = [
    "پیش‌نمایش مکاتبهٔ شما:",
    `فرستنده: ${data.sender_type ? EXTERNAL_SENDER_TYPE_LABEL[data.sender_type] : "-"}`,
    data.sender_org_name_raw ? `سازمان: ${data.sender_org_name_raw}` : null,
    `نام: ${data.sender_full_name ?? "-"}`,
    data.sender_position ? `سمت: ${data.sender_position}` : null,
    data.sender_mobile ? `موبایل: ${data.sender_mobile}` : null,
    data.sender_email ? `ایمیل: ${data.sender_email}` : null,
    `موضوع: ${data.subject ?? "-"}`,
    `شرح: ${data.description ?? "-"}`,
    `تعداد فایل ضمیمه: ${data.documents?.length ?? 0}`,
    "",
    "برای ثبت نهایی، «تأیید و ارسال» را بزنید.",
  ].filter(Boolean);
  return lines.join("\n");
}

async function submitIntake(service: SupabaseClient, chatId: number, telegramUserId: number, data: DraftData): Promise<void> {
  const intakeId = data.intake_id ?? randomUUID();
  const trackingCode = generateTrackingCode();

  const { error } = await service.rpc("external_intake_create_and_submit", {
    p_intake_id: intakeId,
    p_telegram_user_id: telegramUserId,
    p_telegram_chat_id: chatId,
    p_sender_type: data.sender_type,
    p_sender_full_name: data.sender_full_name ?? null,
    p_sender_position: data.sender_position ?? null,
    p_sender_mobile: data.sender_mobile ?? null,
    p_sender_email: data.sender_email ?? null,
    p_sender_org_name_raw: data.sender_org_name_raw ?? null,
    p_subject: data.subject,
    p_description: data.description,
    p_tracking_code: trackingCode,
  });

  if (error) {
    console.error("[external-telegram] submitIntake failed", error);
    await sendMessage(chatId, GENERIC_ERROR_TEXT, MAIN_MENU);
    return;
  }

  for (const doc of data.documents ?? []) {
    const withHash = doc as DraftDocument & { sha256_hash?: string };
    const { error: docErr } = await service.rpc("external_intake_record_document", {
      p_intake_id: intakeId,
      p_telegram_user_id: telegramUserId,
      p_document_id: doc.document_id,
      p_storage_path: doc.storage_path,
      p_file_name_sanitized: doc.file_name_sanitized,
      p_declared_mime: doc.declared_mime,
      p_detected_signature: extensionOf(doc.file_name_sanitized),
      p_size_bytes: doc.size_bytes,
      p_sha256_hash: withHash.sha256_hash ?? "",
    });
    if (docErr) console.error("[external-telegram] external_intake_record_document failed", docErr);
  }

  await clearState(service, chatId);
  await sendMessage(
    chatId,
    `مکاتبهٔ شما با موفقیت دریافت شد و برای بررسی ارسال شد.\n\nکد رهگیری شما: ${trackingCode}\n\nاین کد را نزد خود نگه دارید تا بتوانید وضعیت مکاتبه را پیگیری کنید.`,
    MAIN_MENU,
  );
}

// ---------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------
async function showMySubmissions(service: SupabaseClient, chatId: number, telegramUserId: number): Promise<void> {
  const { data, error } = await service.rpc("external_intake_get_my_submissions", { p_telegram_user_id: telegramUserId });
  if (error) {
    await sendMessage(chatId, GENERIC_ERROR_TEXT, MAIN_MENU);
    return;
  }
  const rows = (data ?? []) as { id: string; tracking_code: string; subject: string; status: ExternalIntakeStatus; created_at: string }[];
  if (rows.length === 0) {
    await sendMessage(chatId, "هیچ مکاتبه‌ای برای شما ثبت نشده است.", MAIN_MENU);
    return;
  }
  const buttons: InlineKeyboardButton[][] = rows.map((r) => [
    { text: `${r.subject} — ${EXTERNAL_INTAKE_PUBLIC_STATUS_LABEL[r.status]}`, callback_data: `track:show:${r.tracking_code}` },
  ]);
  await sendMessage(chatId, "مکاتبات شما:", buttons);
}

async function showTrackingStatus(service: SupabaseClient, chatId: number, telegramUserId: number, trackingCode: string): Promise<void> {
  const code = trackingCode.trim().toUpperCase();
  if (!code) {
    await sendMessage(chatId, "کد رهگیری نامعتبر است.", MAIN_MENU);
    return;
  }
  const { data, error } = await service.rpc("external_intake_get_status", { p_tracking_code: code, p_telegram_user_id: telegramUserId });
  const row = (data ?? [])[0] as { id: string; tracking_code: string; subject: string; status: ExternalIntakeStatus; created_at: string } | undefined;
  if (error || !row) {
    await sendMessage(chatId, "مکاتبه‌ای با این کد رهگیری یافت نشد.", MAIN_MENU);
    return;
  }
  const statusLabel = EXTERNAL_INTAKE_PUBLIC_STATUS_LABEL[row.status];
  const buttons: InlineKeyboardButton[][] =
    row.status === "NEEDS_INFORMATION" ? [[{ text: "ارسال اطلاعات تکمیلی", callback_data: `addinfo:${row.tracking_code}` }]] : [];
  await sendMessage(chatId, `موضوع: ${row.subject}\nوضعیت: ${statusLabel}\nکد رهگیری: ${row.tracking_code}`, [...buttons, ...MAIN_MENU]);
}

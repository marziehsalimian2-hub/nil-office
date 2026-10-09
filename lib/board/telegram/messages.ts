/**
 * Board bot texts, keyboards and notification messages. PURE (no DB, no network) so it is unit-tested.
 * Plain text only (no Markdown/HTML parse mode), so user-typed content can never break formatting or inject links.
 */
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { boardDate, boardWeekday } from "@/lib/board/time";
import { BOARD_FOLLOW_STATUS_LABEL, type BoardFollowStatus } from "@/lib/board/types";
import type { InlineKeyboardButton } from "./bot";

export const REPORT_STATUSES = ["IN_PROGRESS", "PENDING_REVIEW", "BLOCKED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_BUTTON: Record<ReportStatus, string> = {
  IN_PROGRESS: "🔄 در حال انجام",
  PENDING_REVIEW: "✅ انجام شد — برای بررسی",
  BLOCKED: "⛔ متوقف / مانع دارد",
};

export const T = {
  notLinked:
    "این ربات مخصوص اعضای هیئت‌مدیرهٔ شرکت توسعه مدیریت راهبردی نیل است.\nبرای اتصال، لینک اختصاصی خود را از دبیر هیئت‌مدیره دریافت کنید.",
  linkInvalid: "این لینک اتصال نامعتبر، منقضی یا قبلاً استفاده شده است. لطفاً لینک تازه‌ای از دبیر هیئت‌مدیره بگیرید.",
  linkInUse: "این حساب تلگرام قبلاً به عضو دیگری وصل شده است. لطفاً با دبیر هیئت‌مدیره تماس بگیرید.",
  linked: (name: string) => `${name} عزیز، حساب تلگرام شما به دبیرخانهٔ هیئت‌مدیرهٔ نیل وصل شد.`,
  menu: "از گزینه‌های زیر انتخاب کنید:",
  help:
    "• «مصوبات من»: مصوبات باز که مسئول آن هستید؛ برای هر مصوبه می‌توانید پیشرفت را با توضیح و فایل مستند ثبت کنید.\n" +
    "• «صورت‌جلسه‌ها»: دریافت فایل نهایی صورت‌جلسه‌های تأییدشده.\n" +
    "بستن نهایی هر مصوبه با تأیید دبیر هیئت‌مدیره انجام می‌شود.",
  noOpen: "در حال حاضر مصوبهٔ بازی که مسئول آن باشید وجود ندارد.",
  noMinutes: "هنوز صورت‌جلسهٔ تأییدشده‌ای وجود ندارد.",
  askNote: "توضیح کوتاهی دربارهٔ وضعیت این مصوبه بنویسید:",
  askFiles: "در صورت تمایل فایل مستند (PDF، JPG یا PNG — حداکثر ۱۰ مگابایت) را بفرستید، سپس «ثبت گزارش» را بزنید.",
  fileReceived: (n: number) => `فایل دریافت شد (${toFaDigits(n)}). فایل دیگری بفرستید یا «ثبت گزارش» را بزنید.`,
  tooManyFiles: "حداکثر ۵ فایل برای هر گزارش مجاز است. «ثبت گزارش» را بزنید.",
  fileFailed: "دریافت فایل ناموفق بود. دوباره بفرستید.",
  noteEmpty: "لطفاً توضیح را به‌صورت متن بفرستید.",
  submitted: "گزارش شما ثبت شد و برای دبیر هیئت‌مدیره فرستاده شد.",
  submittedProgress: "گزارش پیشرفت ثبت شد.",
  cancelled: "لغو شد.",
  notAllowed: "این مصوبه در دسترس شما نیست یا دیگر باز نیست.",
  error: "در انجام درخواست مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
  sendingPdf: "در حال آماده‌سازی فایل…",
  pdfFailed: "ارسال فایل ناموفق بود. لطفاً بعداً دوباره تلاش کنید.",
  // Phase 3 — notes → assistant draft (secretary only)
  notesPickMeeting: "یادداشت‌ها برای کدام جلسه است؟ (فقط جلسه‌های پیش‌نویس)",
  noDraftMeetings: "جلسهٔ پیش‌نویسی وجود ندارد. ابتدا جلسه را در سامانه بسازید.",
  notesStart:
    "یادداشت‌های جلسه را بفرستید — یک یا چند پیام متنی. برای گفتن به‌جای نوشتن، از دکمهٔ میکروفون کیبورد گوشی استفاده کنید (پیام صوتی پذیرفته نمی‌شود).\nبعد «ساخت پیش‌نویس» را بزنید.",
  notesReceived: (chars: number) => `دریافت شد (${toFaDigits(chars)} نویسه). ادامه دهید یا «ساخت پیش‌نویس» را بزنید.`,
  notesTooLong: "یادداشت‌ها از سقف ۲۰٬۰۰۰ نویسه گذشت؛ «ساخت پیش‌نویس» را بزنید و بقیه را در نوبت بعد بفرستید.",
  notesEmpty: "هنوز یادداشتی نفرستاده‌اید.",
  voiceRejected: "پیام صوتی پردازش نمی‌شود. لطفاً با دکمهٔ میکروفون کیبورد گوشی، متن بفرستید.",
  drafting: "در حال ساخت پیش‌نویس… (ممکن است تا یک دقیقه طول بکشد)",
  notDrafter: "ساخت پیش‌نویس فقط برای دبیر هیئت‌مدیره فعال است.",
  draftReady: (agenda: number, res: number, warnings: number, url: string | null) =>
    `پیشنهاد دستیار آماده شد: ${toFaDigits(agenda)} بند مذاکرات، ${toFaDigits(res)} مصوبه${warnings ? `، ${toFaDigits(warnings)} نکتهٔ نیازمند بررسی` : ""}.\nهیچ‌چیز هنوز به صورت‌جلسه اضافه نشده؛ در سامانه بررسی و اعمال کنید${url ? `:\n${url}` : "."}`,
};

export const MAIN_MENU: InlineKeyboardButton[][] = [
  [{ text: "📋 مصوبات من", callback_data: "my" }],
  [{ text: "📄 صورت‌جلسه‌ها", callback_data: "mins" }],
  [{ text: "❓ راهنما", callback_data: "help" }],
];
/** The secretary (a member linked to a profile with board drafting rights) also gets «یادداشت جلسه». */
export const menuFor = (canDraft: boolean): InlineKeyboardButton[][] =>
  canDraft ? [[{ text: "📝 یادداشت جلسه (دستیار)", callback_data: "notes" }], ...MAIN_MENU] : MAIN_MENU;
export const NOTES_KB: InlineKeyboardButton[][] = [[{ text: "ساخت پیش‌نویس", callback_data: "mk" }], [{ text: "انصراف", callback_data: "cancel" }]];
export const CANCEL_ROW: InlineKeyboardButton[] = [{ text: "انصراف", callback_data: "cancel" }];
export const SUBMIT_KB: InlineKeyboardButton[][] = [[{ text: "ثبت گزارش", callback_data: "submit" }], CANCEL_ROW];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type Callback =
  | { t: "menu" } | { t: "my" } | { t: "mins" } | { t: "help" } | { t: "cancel" } | { t: "submit" } | { t: "notes" } | { t: "mk" }
  | { t: "res"; id: string } | { t: "min"; id: string } | { t: "nt"; id: string } | { t: "st"; id: string; status: ReportStatus };

/** Strict parser: anything not exactly one of these shapes is ignored (callback_data is client-controlled). */
export function parseCallback(data: string | undefined): Callback | null {
  if (!data) return null;
  if (data === "menu" || data === "my" || data === "mins" || data === "help" || data === "cancel" || data === "submit" || data === "notes" || data === "mk") return { t: data };
  let m = new RegExp(`^(res|min|nt):(${UUID})$`).exec(data);
  if (m) return { t: m[1] as "res" | "min" | "nt", id: m[2] };
  m = new RegExp(`^st:(${UUID}):(IN_PROGRESS|PENDING_REVIEW|BLOCKED)$`).exec(data);
  if (m) return { t: "st", id: m[1], status: m[2] as ReportStatus };
  return null;
}

const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);
const num = (n: string | null | undefined) => (n ? toFaDigits(n) : "—");
const date = (d: string | null | undefined) => (d ? formatJalali(d) : "—");

export type ResRow = {
  id: string; resolution_number: string | null; text: string; due_date: string | null; expected_output: string | null; follow_status: BoardFollowStatus;
};

export function myResolutionsKeyboard(rows: ResRow[]): InlineKeyboardButton[][] {
  return [
    ...rows.map((r) => [{ text: `${num(r.resolution_number)} · مهلت ${date(r.due_date)} · ${short(r.text, 24)}`, callback_data: `res:${r.id}` }]),
    [{ text: "بازگشت", callback_data: "menu" }],
  ];
}

export function resolutionDetailText(r: ResRow, today: string, lastNote?: string | null): string {
  const overdue = r.due_date && r.due_date < today && r.follow_status !== "DONE";
  return [
    `مصوبهٔ ${num(r.resolution_number)}`,
    r.text,
    "",
    `مهلت: ${date(r.due_date)}${overdue ? " (گذشته)" : ""}`,
    r.expected_output ? `خروجی مورد انتظار: ${r.expected_output}` : null,
    `وضعیت فعلی: ${BOARD_FOLLOW_STATUS_LABEL[r.follow_status]}`,
    lastNote ? `آخرین گزارش: ${short(lastNote, 300)}` : null,
  ].filter((x) => x !== null).join("\n");
}

export function resolutionActionsKeyboard(id: string): InlineKeyboardButton[][] {
  return [
    ...REPORT_STATUSES.map((s) => [{ text: REPORT_STATUS_BUTTON[s], callback_data: `st:${id}:${s}` }]),
    [{ text: "بازگشت", callback_data: "my" }],
  ];
}

export type MeetingRow = { id: string; meeting_number: number | null; scheduled_at: string };

export function draftMeetingsKeyboard(rows: { id: string; scheduled_at: string }[]): InlineKeyboardButton[][] {
  return [
    ...rows.map((m) => [{ text: `پیش‌نویس جلسهٔ ${boardWeekday(m.scheduled_at)} ${boardDate(m.scheduled_at)}`, callback_data: `nt:${m.id}` }]),
    [{ text: "بازگشت", callback_data: "menu" }],
  ];
}

export function minutesKeyboard(rows: MeetingRow[]): InlineKeyboardButton[][] {
  return [
    ...rows.map((m) => [{ text: `جلسهٔ ${m.meeting_number ? toFaDigits(m.meeting_number) : "—"} · ${boardDate(m.scheduled_at)}`, callback_data: `min:${m.id}` }]),
    [{ text: "بازگشت", callback_data: "menu" }],
  ];
}

export const minutesCaption = (m: MeetingRow) =>
  `صورت‌جلسهٔ شمارهٔ ${m.meeting_number ? toFaDigits(m.meeting_number) : "—"} هیئت‌مدیره — ${boardWeekday(m.scheduled_at)} ${boardDate(m.scheduled_at)}`;

/* ------------------------------------------------ notifications ------------------------------------------------ */

export type NotificationKind = "MINUTES" | "NEW_RESOLUTIONS" | "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "REVIEW_REQUEST" | "CLOSED" | "REOPENED" | "DIGEST";

export type NotificationContext = {
  kind: NotificationKind;
  memberName: string;
  meeting?: MeetingRow | null;
  resolution?: (ResRow & { owner_name?: string | null }) | null;
  resolutions?: ResRow[];                     // NEW_RESOLUTIONS: the member's resolutions of that meeting
  lastNote?: string | null;                   // REVIEW_REQUEST: the owner's report
  payload: Record<string, unknown>;
};

/** Text of one outbox notification (MINUTES is a caption under the PDF). Null = nothing sensible to send. */
export function notificationText(c: NotificationContext): string | null {
  const r = c.resolution;
  const head = r ? `مصوبهٔ ${num(r.resolution_number)}: ${short(r.text, 200)}` : "";
  switch (c.kind) {
    case "MINUTES":
      return c.meeting ? `${minutesCaption(c.meeting)}\nنسخهٔ نهایی تأییدشده — با کد استعلام اصالت.` : null;
    case "NEW_RESOLUTIONS":
      if (!c.meeting || !c.resolutions?.length) return null;
      return [
        `${c.memberName} عزیز، در جلسهٔ ${c.meeting.meeting_number ? toFaDigits(c.meeting.meeting_number) : "—"} هیئت‌مدیره مسئولیت این مصوبات با شماست:`,
        ...c.resolutions.map((x) => `• ${num(x.resolution_number)} — ${short(x.text, 150)} — مهلت ${date(x.due_date)}`),
        "",
        "پیشرفت را از «مصوبات من» ثبت کنید.",
      ].join("\n");
    case "DUE_SOON":
      return r ? `یادآوری: ۳ روز تا مهلت\n${head}\nمهلت: ${date(r.due_date)}` : null;
    case "DUE_TODAY":
      return r ? `یادآوری: امروز مهلت این مصوبه است\n${head}` : null;
    case "OVERDUE": {
      const days = Math.abs(Number(c.payload.days ?? 0));
      return r ? `مهلت این مصوبه ${toFaDigits(days)} روز گذشته است\n${head}\nلطفاً وضعیت را از «مصوبات من» ثبت کنید.` : null;
    }
    case "REVIEW_REQUEST":
      return r
        ? `گزارش انجام برای بررسی رسید\n${head}\nمسئول: ${r.owner_name ?? "—"}${c.lastNote ? `\nگزارش: ${short(c.lastNote, 500)}` : ""}\n\nبرای بستن یا بازگرداندن، صفحهٔ مصوبه را در سامانه باز کنید.`
        : null;
    case "CLOSED":
      return r ? `مصوبه با تأیید دبیر هیئت‌مدیره بسته شد ✅\n${head}${typeof c.payload.note === "string" ? `\nنتیجه: ${short(c.payload.note, 500)}` : ""}` : null;
    case "REOPENED":
      return r ? `مصوبه برای اقدام بیشتر بازگشایی شد\n${head}${typeof c.payload.note === "string" ? `\nدلیل: ${short(c.payload.note, 500)}` : ""}` : null;
    case "DIGEST": {
      const o = Number(c.payload.overdue ?? 0);
      const p = Number(c.payload.pending_review ?? 0);
      return `خلاصهٔ امروز دبیرخانه\nمصوبات عقب‌افتاده: ${toFaDigits(o)}\nمنتظر بررسی شما: ${toFaDigits(p)}`;
    }
  }
}


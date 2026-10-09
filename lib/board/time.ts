/**
 * Board meeting times are entered and shown as Tehran wall-clock time, independent of the server's TZ.
 * Iran abolished daylight saving in 2022, so Asia/Tehran is a fixed +03:30 for every date this module can hold.
 * Pure (importable from client components).
 */
import { formatJalali, toFaDigits } from "@/lib/jalali";

const TEHRAN_OFFSET = "+03:30";

function parts(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Tehran calendar date «YYYY-MM-DD» of an instant. */
export function tehranDate(iso: string | Date | null | undefined): string | null {
  return iso ? parts(iso)?.date ?? null : null;
}

/** Tehran wall-clock time «HH:MM» of an instant. */
export function tehranTime(iso: string | Date | null | undefined): string | null {
  return iso ? parts(iso)?.time ?? null : null;
}

/** «۱۴۰۵/۰۷/۱۷» in Tehran. */
export function boardDate(iso: string | null | undefined): string {
  const d = tehranDate(iso);
  return d ? formatJalali(d) : "—";
}

/** «۰۹:۳۰» in Tehran. */
export function boardTime(iso: string | null | undefined): string {
  const t = tehranTime(iso);
  return t ? toFaDigits(t) : "—";
}

/** «۱۴۰۵/۰۷/۱۷ ساعت ۰۹:۳۰» in Tehran. */
export function boardDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${boardDate(iso)} ساعت ${boardTime(iso)}`;
}

/** Persian weekday name in Tehran (e.g. «سه‌شنبه»). */
export function boardWeekday(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", weekday: "long" }).format(d);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Gregorian date «YYYY-MM-DD» (from JalaliDateInput) + Tehran «HH:MM» -> ISO instant with the Tehran offset, or null if invalid. */
export function combineTehran(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date || !time || !DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const iso = `${date}T${time}:00${TEHRAN_OFFSET}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** Normalises a typed time («۹:۳۰», «9.30», «09:30») to «HH:MM», or null. */
export function normalizeTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const en = raw.trim().replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
  const m = en.match(/^(\d{1,2})[:.٫](\d{2})$/);
  if (!m) return null;
  const t = `${m[1].padStart(2, "0")}:${m[2]}`;
  return TIME_RE.test(t) ? t : null;
}

/** Adds whole days to an instant (used for the «+14 days» next-meeting suggestion; fixed offset, so no DST drift). */
export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

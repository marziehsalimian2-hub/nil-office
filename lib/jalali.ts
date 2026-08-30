/**
 * Gregorian <-> Jalali conversion.
 * Core algorithm ported from the well-tested `jalaali-js` (MIT).
 * Kept dependency-free and canonical so date handling is not brittle
 * string logic. Dates are stored in the DB as ISO (Gregorian) and only
 * converted for display/entry here.
 */

const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

function jalCal(jy: number) {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
    2192, 2262, 2324, 2394, 2456, 3178,
  ];
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  for (let i = 1; i < breaks.length; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  return (
    div(1461 * (gy + 4800 + div(gm - 14, 12)), 4) +
    div(367 * (gm - 2 - 12 * div(gm - 14, 12)), 12) -
    div(3 * div(gy + 4900 + div(gm - 14, 12), 100), 4) +
    gd -
    32075
  );
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export function toJalaali(gy: number, gm: number, gd: number) {
  return d2j(g2d(gy, gm, gd));
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let jd: number;
  let jm: number;
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function toGregorian(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1);
}

const jdnToDate = (jdn: number) => {
  const g = d2g(jdn);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
};

/** Wall-clock Gregorian date in Asia/Tehran, independent of the runtime's local TZ. */
function tehranYMD(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Current Jalali year (authoritative value passed to numbering RPCs). */
export function currentJalaliYear(now: Date = new Date()): number {
  const { y, m, d } = tehranYMD(now);
  return toJalaali(y, m, d).jy;
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
export const toFaDigits = (s: string | number) =>
  String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
export const toEnDigits = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));

/** Format an ISO date (or Date) as a Jalali string, e.g. ۱۴۰۵/۰۳/۰۷ */
export function formatJalali(input: string | Date | null | undefined, fa = true): string {
  if (!input) return "—";

  let gy: number, gm: number, gd: number;
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}(?!T)/.test(input)) {
    // Date-only value (e.g. "2026-08-29"). Read the components directly —
    // routing this through `new Date(...)` would parse it as UTC midnight
    // and then read back local getters, shifting the calendar day by one
    // in any timezone behind UTC.
    const [y, m, d] = input.slice(0, 10).split("-").map(Number);
    gy = y;
    gm = m;
    gd = d;
  } else {
    const d = typeof input === "string" ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return "—";
    gy = d.getFullYear();
    gm = d.getMonth() + 1;
    gd = d.getDate();
  }

  const { jy, jm, jd } = toJalaali(gy, gm, gd);
  const s = `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
  return fa ? toFaDigits(s) : s;
}

/** Parse a Jalali `YYYY/MM/DD` (Persian or Latin digits) into an ISO date. */
export function parseJalali(value: string): string | null {
  const cleaned = toEnDigits(value.trim()).replace(/[-.]/g, "/");
  const m = cleaned.match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  const iso = `${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
  return iso;
}

export { jdnToDate };

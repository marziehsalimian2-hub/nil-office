import "server-only";
import { parseJalali, toEnDigits } from "@/lib/jalali";

/**
 * Server-authoritative relative-date resolution (spec §54/55) — "سه روز
 * دیگر" must resolve against the SERVER's own clock, never a value the
 * LLM computed itself (models are unreliable at date arithmetic, and
 * even if they weren't, the spec explicitly forbids trusting them for
 * this). CREATE_TASK_DRAFT/CREATE_FOLLOWUP_DRAFT accept the raw Persian
 * phrase and run it through this resolver; the model never supplies an
 * ISO date directly for a *relative* expression.
 *
 * `todayIso()` deliberately matches the exact "new Date().toISOString()
 * .slice(0,10)" convention already used by every other page in this app
 * (dashboard, tasks list, projects dashboard, etc.) rather than a
 * "more correct" Tehran-timezone-aware today — introducing a second
 * definition of "today" that can disagree with the rest of the app near
 * midnight UTC would be a worse inconsistency than the one it fixes.
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_NUMBER_TO_NAME_FA: Record<number, string[]> = {
  0: ["یکشنبه"],
  1: ["دوشنبه"],
  2: ["سه‌شنبه", "سه شنبه"],
  3: ["چهارشنبه"],
  4: ["پنجشنبه", "پنج‌شنبه", "پنج شنبه"],
  5: ["جمعه"],
  6: ["شنبه"],
};

export type DateResolution = { iso: string; explanation: string } | { error: string };

/**
 * Recognizes a small, fixed set of Persian relative-date phrases plus
 * absolute Jalali (YYYY/MM/DD) and ISO (YYYY-MM-DD) dates. Anything it
 * doesn't recognize is rejected with a clear error asking for a
 * specific date — never guessed.
 */
export function resolveDatePhrase(rawPhrase: string): DateResolution {
  const today = todayIso();
  const phrase = toEnDigits(rawPhrase.trim());

  if (/^\d{4}-\d{2}-\d{2}$/.test(phrase)) return { iso: phrase, explanation: phrase };
  const jalali = parseJalali(phrase);
  if (jalali) return { iso: jalali, explanation: phrase };

  if (/^امروز$/.test(phrase)) return { iso: today, explanation: "امروز" };
  if (/^فردا$/.test(phrase)) return { iso: addDays(today, 1), explanation: "فردا" };
  if (/^پس\s*فردا$/.test(phrase)) return { iso: addDays(today, 2), explanation: "پس‌فردا" };

  const nDaysMatch = phrase.match(/^(\d+)\s*روز\s*(دیگر|آینده|بعد)$/);
  if (nDaysMatch) {
    const n = Number(nDaysMatch[1]);
    return { iso: addDays(today, n), explanation: `${n} روز دیگر` };
  }

  if (/^هفتهٔ?\s*(دیگر|آینده|بعد)$/.test(phrase)) return { iso: addDays(today, 7), explanation: "هفتهٔ دیگر" };

  const nWeeksMatch = phrase.match(/^(\d+)\s*هفتهٔ?\s*(دیگر|آینده|بعد)$/);
  if (nWeeksMatch) {
    const n = Number(nWeeksMatch[1]);
    return { iso: addDays(today, n * 7), explanation: `${n} هفتهٔ دیگر` };
  }

  for (const [num, names] of Object.entries(WEEKDAY_NUMBER_TO_NAME_FA)) {
    if (names.some((n) => phrase === n || phrase === `${n} آینده` || phrase === `${n} بعد`)) {
      const targetDow = Number(num);
      const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
      let delta = (targetDow - todayDow + 7) % 7;
      if (delta === 0) delta = 7; // "next Monday" means the coming one, not today even if today is Monday
      return { iso: addDays(today, delta), explanation: names[0] };
    }
  }

  return { error: `تاریخ «${rawPhrase}» قابل تشخیص نیست. لطفاً یک تاریخ مشخص (مثلاً ۱۴۰۵/۰۶/۱۵) یا عبارتی مثل «فردا»/«۳ روز دیگر» بگویید.` };
}

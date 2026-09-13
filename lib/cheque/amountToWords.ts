/**
 * Deterministic Persian (Farsi) number/amount-to-words conversion for
 * cheque printing and previews (spec §7). Pure, dependency-free, and
 * shared identically by the web form action (app/actions/cheques.ts)
 * and the Assistant's CREATE_CHEQUE_DRAFT handler
 * (lib/assistant/actions/cheque.ts) — one implementation, both callers,
 * so the words shown in a chat preview always match what gets printed.
 */

const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];
const MAX_SUPPORTED = 999_999_999_999_999; // 5 groups of 3 digits — matches SCALES

const CURRENCY_WORD: Record<string, string> = {
  IRR: "ریال",
  TOMAN: "تومان",
  USD: "دلار آمریکا",
  EUR: "یورو",
  AED: "درهم امارات",
  TRY: "لیر ترکیه",
  CNY: "یوان چین",
};

function convertTwoDigits(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]} و ${ONES[ones]}`;
}

function convertThreeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  if (rest > 0) parts.push(convertTwoDigits(rest));
  return parts.join(" و ");
}

/** Converts a non-negative integer into Persian words. `0` -> "صفر". Throws on negative, non-integer, or unsupported magnitude. */
export function numberToPersianWords(input: number): string {
  if (!Number.isFinite(input)) throw new Error("INVALID_NUMBER");
  if (input < 0) throw new Error("NEGATIVE_NOT_SUPPORTED");
  if (!Number.isInteger(input)) throw new Error("NON_INTEGER_NOT_SUPPORTED");
  if (input > MAX_SUPPORTED) throw new Error("NUMBER_TOO_LARGE");
  if (input === 0) return "صفر";

  const groups: number[] = [];
  let rem = input;
  while (rem > 0) {
    groups.unshift(rem % 1000);
    rem = Math.floor(rem / 1000);
  }

  const total = groups.length;
  const parts: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const scaleIndex = total - 1 - i;
    const words = convertThreeDigits(g);
    parts.push(scaleIndex > 0 ? `${words} ${SCALES[scaleIndex]}` : words);
  });
  return parts.join(" و ");
}

/**
 * Cheque-specific entry point: validates the amount is a positive
 * integer (matches the DB's `amount > 0` CHECK — cheques never carry a
 * zero/negative/fractional amount) and appends the currency word. The
 * DB stores amount as numeric(20,4); a fractional cheque amount (sub-
 * unit rial/toman) has no natural Persian words rendering, so this
 * requires an integer and the caller is expected to round/validate
 * before calling.
 */
export function amountToPersianWords(amount: number, currencyCode: string): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  if (!Number.isInteger(amount)) throw new Error("NON_INTEGER_AMOUNT");
  const words = numberToPersianWords(amount);
  const currencyWord = CURRENCY_WORD[currencyCode] ?? currencyCode;
  return `${words} ${currencyWord}`;
}

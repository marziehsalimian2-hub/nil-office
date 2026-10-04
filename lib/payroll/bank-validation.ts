import { toEnDigits } from "@/lib/jalali";

export const normalizeIban = (s: string) => toEnDigits(s).replace(/\s/g, "").toUpperCase();
export const normalizeDigits = (s: string) => toEnDigits(s).replace(/[\s-]/g, "");

function mod97(digits: string): number {
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return r;
}

export function ibanChecksumOk(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return mod97(rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))) === 1;
}

export const isValidIranSheba = (iban: string) => /^IR[0-9]{24}$/.test(iban) && ibanChecksumOk(iban);

export function isValidCardNumber(card: string): boolean {
  if (!/^\d{16}$/.test(card)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = Number(card[15 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

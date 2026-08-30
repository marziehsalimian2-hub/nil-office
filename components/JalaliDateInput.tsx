"use client";

import { useState } from "react";
import { formatJalali, parseJalali, toEnDigits } from "@/lib/jalali";

/**
 * Accepts a Jalali date (Persian or Latin digits, YYYY/MM/DD) and submits
 * the canonical Gregorian ISO value under `name`. Empty is allowed.
 */
export function JalaliDateInput({
  name,
  defaultISO,
  required,
}: {
  name: string;
  defaultISO?: string | null;
  required?: boolean;
}) {
  const [text, setText] = useState(defaultISO ? formatJalali(defaultISO, false) : "");
  const iso = text.trim() ? parseJalali(text) : "";
  const invalid = text.trim() !== "" && iso === null;

  return (
    <div>
      <input
        dir="ltr"
        inputMode="numeric"
        placeholder="۱۴۰۵/۰۳/۰۷"
        value={text}
        onChange={(e) => setText(toEnDigits(e.target.value))}
        className="input text-center tnum"
        aria-invalid={invalid}
      />
      <input type="hidden" name={name} value={iso ?? ""} required={required} />
      {invalid && (
        <p className="mt-1 text-xs text-status-cancelled">
          قالب تاریخ نامعتبر است (مثال: ۱۴۰۵/۰۳/۰۷)
        </p>
      )}
    </div>
  );
}

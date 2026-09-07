"use client";

import { useEffect, useState } from "react";
import { toFaDigits } from "@/lib/jalali";

/**
 * Display-only countdown — the server-supplied `deadlineIso` is the only
 * input, and every actual submit/upload action re-validates against the
 * real server clock regardless of what this shows (spec §10/§41: a
 * frozen or manipulated client clock must never grant extra time).
 *
 * `now` starts as `null` (rendered identically on server and on the
 * client's first hydration pass — a `Date.now()` state initializer would
 * differ between those two moments and trigger a hydration mismatch).
 * The real countdown only appears once mounted, via useEffect.
 */
export function CountdownTimer({ label, deadlineIso, expired }: { label: string; deadlineIso: string; expired: boolean }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (expired) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expired]);

  let display = "…";
  let isExpired = expired;
  if (now !== null) {
    const remainingMs = new Date(deadlineIso).getTime() - now;
    isExpired = expired || remainingMs <= 0;
    if (isExpired) {
      display = "به پایان رسیده";
    } else {
      const totalSeconds = Math.floor(remainingMs / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const hh = String(hours).padStart(2, "0");
      const mm = String(minutes).padStart(2, "0");
      const ss = String(seconds).padStart(2, "0");
      display = days > 0
        ? `${toFaDigits(days)} روز و ${toFaDigits(hh)}:${toFaDigits(mm)}:${toFaDigits(ss)}`
        : `${toFaDigits(hh)}:${toFaDigits(mm)}:${toFaDigits(ss)}`;
    }
  }

  return (
    <div className="rounded-lg border border-paper-line bg-paper-card p-3 text-center">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 tnum text-lg font-semibold ${isExpired ? "text-status-cancelled" : "text-ink"}`}>{display}</p>
    </div>
  );
}

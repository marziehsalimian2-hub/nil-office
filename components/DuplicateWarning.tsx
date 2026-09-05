"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Non-blocking "possible duplicate" notice — never prevents submission (spec §29/§30). */
export function DuplicateWarning({
  items,
}: {
  items: { id: string; label: string; sublabel?: string | null; href?: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-status-waiting/40 bg-status-waiting/10 px-3 py-2.5 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <AlertTriangle className="h-4 w-4 text-status-waiting" /> موارد مشابه یافت شد — ممکن است قبلاً ثبت شده باشد
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {items.map((it) =>
          it.href ? (
            <li key={it.id}>
              <Link href={it.href} target="_blank" className="text-seal hover:underline">
                {it.label}
              </Link>
              {it.sublabel && <span className="text-ink-muted"> — {it.sublabel}</span>}
            </li>
          ) : (
            <li key={it.id} className="text-ink-muted">
              {it.label}
              {it.sublabel && <span> — {it.sublabel}</span>}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

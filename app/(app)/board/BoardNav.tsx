"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/board", label: "جلسات", match: (p: string) => p === "/board" || p.startsWith("/board/meetings") },
  { href: "/board/resolutions", label: "دفتر مصوبات", match: (p: string) => p.startsWith("/board/resolutions") },
  { href: "/board/members", label: "اعضا و تنظیمات", match: (p: string) => p.startsWith("/board/members") },
];

export function BoardNav() {
  const pathname = usePathname();
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-paper-line">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-medium transition",
            it.match(pathname) ? "border-seal text-ink" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

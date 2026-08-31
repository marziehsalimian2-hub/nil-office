"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Tab = { label: string; content: React.ReactNode };

/** Minimal client-side tab primitive — no external library, no persisted state. */
export function Tabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-paper-line">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            onClick={() => setActive(i)}
            aria-selected={active === i}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition",
              active === i ? "border-seal text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tabs[active]?.content}</div>
    </div>
  );
}

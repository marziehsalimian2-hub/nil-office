"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moveOpportunityStage } from "@/app/actions/crm-opportunities";
import { formatMoney } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";

type Stage = { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean };
type Card = {
  id: string;
  opportunity_number: string;
  title: string;
  stage_id: string;
  estimated_value: number | null;
  currency_code: string;
  companyName: string | null;
  ownerName: string | null;
};

export function BoardClient({ stages, cards }: { stages: Stage[]; cards: Card[] }) {
  const router = useRouter();
  const [items, setItems] = useState(cards);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);

  function onDrop(stageId: string) {
    if (!dragId) return;
    const card = items.find((c) => c.id === dragId);
    if (!card || card.stage_id === stageId) return;

    const prevStage = card.stage_id;
    setItems((cur) => cur.map((c) => (c.id === dragId ? { ...c, stage_id: stageId } : c)));

    const fd = new FormData();
    fd.append("id", dragId);
    fd.append("stage_id", stageId);
    startTransition(async () => {
      const res = await moveOpportunityStage(null, fd);
      if (res && "error" in res && res.error) {
        setError(res.error);
        setItems((cur) => cur.map((c) => (c.id === dragId ? { ...c, stage_id: prevStage } : c)));
      } else {
        router.refresh();
      }
    });
    setDragId(null);
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-status-cancelled/30 bg-status-cancelled/5 px-3 py-2 text-sm text-status-cancelled">
          {error}
        </div>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const stageCards = items.filter((c) => c.stage_id === s.id);
          return (
            <div
              key={s.id}
              className="w-72 shrink-0 rounded-xl border border-paper-line bg-paper/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(s.id)}
            >
              <div className="border-b border-paper-line px-3 py-2">
                <p className="text-sm font-medium text-ink">{s.name}</p>
                <p className="text-xs text-ink-muted tnum">{toFaDigits(stageCards.length)} فرصت</p>
              </div>
              <div className="space-y-2 p-2">
                {stageCards.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    className="cursor-move rounded-lg border border-paper-line bg-paper-card p-3 shadow-sm"
                  >
                    <Link href={`/opportunities/${c.id}`} className="text-sm font-medium text-ink hover:underline">
                      {c.title}
                    </Link>
                    <p className="mt-1 text-xs text-ink-muted tnum">{toFaDigits(c.opportunity_number)}</p>
                    {c.companyName && <p className="mt-1 text-xs text-ink-muted">{c.companyName}</p>}
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-ink-muted">{c.ownerName ?? "—"}</span>
                      {c.estimated_value != null && (
                        <span className="tnum font-medium text-seal">{formatMoney(c.estimated_value)} {c.currency_code}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

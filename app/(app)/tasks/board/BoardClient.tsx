"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moveTaskStatus } from "@/app/actions/tasks";
import { TASK_STATUS_LABEL, PM_PRIORITY_LABEL, type TaskStatus, type PmPriority } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";

const COLUMNS: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "WAITING", "DONE"];

type Card = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: PmPriority;
  due_date: string | null;
  projectLabel: string | null;
  assigneeName: string | null;
};

export function BoardClient({ cards }: { cards: Card[] }) {
  const router = useRouter();
  const [items, setItems] = useState(cards);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);

  function onDrop(status: TaskStatus) {
    if (!dragId) return;
    const card = items.find((c) => c.id === dragId);
    if (!card || card.status === status) return;

    const prevStatus = card.status;
    setItems((cur) => cur.map((c) => (c.id === dragId ? { ...c, status } : c)));

    const fd = new FormData();
    fd.append("id", dragId);
    fd.append("status", status);
    startTransition(async () => {
      const res = await moveTaskStatus(null, fd);
      if (res && "error" in res && res.error) {
        setError(res.error);
        setItems((cur) => cur.map((c) => (c.id === dragId ? { ...c, status: prevStatus } : c)));
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
        {COLUMNS.map((status) => {
          const colCards = items.filter((c) => c.status === status);
          return (
            <div
              key={status}
              className="w-72 shrink-0 rounded-xl border border-paper-line bg-paper/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(status)}
            >
              <div className="border-b border-paper-line px-3 py-2">
                <p className="text-sm font-medium text-ink">{TASK_STATUS_LABEL[status]}</p>
                <p className="text-xs text-ink-muted">{colCards.length} کار</p>
              </div>
              <div className="space-y-2 p-2">
                {colCards.map((c) => (
                  <div key={c.id} draggable onDragStart={() => setDragId(c.id)} className="cursor-move rounded-lg border border-paper-line bg-paper-card p-3 shadow-sm">
                    <Link href={`/tasks/${c.id}`} className="text-sm font-medium text-ink hover:underline">{c.title}</Link>
                    {c.projectLabel && <p className="mt-1 text-xs text-ink-muted">{c.projectLabel}</p>}
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-ink-muted">{c.assigneeName ?? "—"}</span>
                      <span className="text-ink-muted">{PM_PRIORITY_LABEL[c.priority]}</span>
                    </div>
                    {c.due_date && <p className="mt-1 text-xs text-ink-muted tnum">{formatJalali(c.due_date)}</p>}
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

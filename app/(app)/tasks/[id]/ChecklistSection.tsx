"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { addChecklistItem, toggleChecklistItem, deleteChecklistItem } from "@/app/actions/task-checklist";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TaskChecklistItem } from "@/lib/types/database";

export function ChecklistSection({ taskId, items }: { taskId: string; items: TaskChecklistItem[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await addChecklistItem(null, fd);
      setLabel("");
      router.refresh();
    });
  }

  function toggle(item: TaskChecklistItem) {
    const fd = new FormData();
    fd.append("id", item.id);
    fd.append("task_id", taskId);
    fd.append("is_done", String(!item.is_done));
    startTransition(async () => {
      await toggleChecklistItem(null, fd);
      router.refresh();
    });
  }

  function remove(id: string) {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("task_id", taskId);
    startTransition(async () => {
      await deleteChecklistItem(null, fd);
      router.refresh();
    });
  }

  const done = items.filter((i) => i.is_done).length;

  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">چک‌لیست {items.length > 0 && <span className="tnum text-ink-muted">({done}/{items.length})</span>}</p>
      {items.length === 0 ? (
        <p className="mb-3 text-sm text-ink-muted">آیتمی ثبت نشده است.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <input type="checkbox" checked={item.is_done} disabled={pending} onChange={() => toggle(item)} />
              <span className={cn("flex-1 text-sm", item.is_done ? "text-ink-muted line-through" : "text-ink")}>{item.label}</span>
              <button type="button" disabled={pending} className="btn-quiet p-1" aria-label="حذف" onClick={() => remove(item.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input type="hidden" name="task_id" value={taskId} />
        <input name="label" required placeholder="آیتم جدید…" className="input flex-1" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" disabled={pending} className="btn-quiet p-2" aria-label="افزودن"><Plus className="h-4 w-4" /></button>
      </form>
    </Card>
  );
}

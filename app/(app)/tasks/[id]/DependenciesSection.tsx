"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { addDependency, removeDependency } from "@/app/actions/task-dependencies";
import { FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { TaskStatusBadge } from "@/components/TaskStatusBadge";
import type { TaskStatus } from "@/lib/enums";

type DepRow = { id: string; task: { id: string; title: string; status: TaskStatus } };
type Opt = { id: string; label: string };

export function DependenciesSection({
  taskId,
  blockedBy,
  blocking,
  candidateTasks,
}: {
  taskId: string;
  blockedBy: DepRow[];
  blocking: DepRow[];
  candidateTasks: Opt[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addDependency(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("task_id", taskId);
    startTransition(async () => {
      await removeDependency(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">مسدود توسط</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> افزودن وابستگی
          </button>
        )}
      </div>
      <FormError message={error} />
      {adding && (
        <form onSubmit={handleSubmit} className="mb-3 flex gap-2">
          <input type="hidden" name="task_id" value={taskId} />
          <select name="depends_on_task_id" required className="input flex-1">
            <option value="">— انتخاب کار —</option>
            {candidateTasks.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
          </select>
          <button type="submit" disabled={pending} className="btn-primary text-xs">افزودن</button>
          <button type="button" disabled={pending} className="btn-quiet text-xs" onClick={() => setAdding(false)}>انصراف</button>
        </form>
      )}
      {blockedBy.length === 0 ? (
        <p className="text-sm text-ink-muted">این کار مسدود نیست.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {blockedBy.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <Link href={`/tasks/${d.task.id}`} className="flex-1 text-sm text-seal hover:underline">{d.task.title}</Link>
              <TaskStatusBadge status={d.task.status} />
              <button type="button" disabled={pending} className="btn-quiet p-1.5" aria-label="حذف" onClick={() => remove(d.id)}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {blocking.length > 0 && (
        <div className="mt-4 border-t border-paper-line/60 pt-3">
          <p className="mb-2 text-xs text-ink-muted">این کار، مسدودکنندهٔ کارهای زیر است:</p>
          <ul className="space-y-1">
            {blocking.map((d) => (
              <li key={d.id}>
                <Link href={`/tasks/${d.task.id}`} className="text-sm text-seal hover:underline">{d.task.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

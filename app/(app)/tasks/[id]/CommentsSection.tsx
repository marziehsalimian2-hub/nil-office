"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { createComment, updateComment } from "@/app/actions/task-comments";
import { FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import type { TaskComment } from "@/lib/types/database";

export function CommentsSection({
  taskId,
  comments,
  currentUserId,
  authorNames,
}: {
  taskId: string;
  comments: TaskComment[];
  currentUserId: string;
  authorNames: Map<string, string>;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createComment(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setBody("");
        router.refresh();
      }
    });
  }

  function submitEdit(id: string) {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("task_id", taskId);
    fd.append("body", editBody);
    startTransition(async () => {
      const res = await updateComment(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setEditingId(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">یادداشت‌ها و گزارش کار</p>
      <FormError message={error} />
      {comments.length === 0 ? (
        <p className="mb-3 text-sm text-ink-muted">هنوز یادداشتی ثبت نشده است.</p>
      ) : (
        <ul className="mb-3 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-paper-line/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink">{authorNames.get(c.author_user_id) ?? "—"}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted tnum">{formatJalali(c.updated_at ?? c.created_at)}{c.updated_at && " (ویرایش‌شده)"}</span>
                  {c.author_user_id === currentUserId && editingId !== c.id && (
                    <button type="button" className="text-ink-muted hover:text-ink" aria-label="ویرایش" onClick={() => { setEditingId(c.id); setEditBody(c.body); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {editingId === c.id ? (
                <div className="space-y-2">
                  <textarea rows={2} className="input" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                  <div className="flex gap-2">
                    <button disabled={pending} className="btn-primary text-xs" onClick={() => submitEdit(c.id)}>ذخیره</button>
                    <button className="btn-quiet text-xs" onClick={() => setEditingId(null)}>انصراف</button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-ink">{c.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-2">
        <input type="hidden" name="task_id" value={taskId} />
        <textarea name="body" rows={2} required className="input" placeholder="یادداشت جدید…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="submit" disabled={pending || !body.trim()} className="btn-primary text-xs">ثبت یادداشت</button>
      </form>
    </Card>
  );
}

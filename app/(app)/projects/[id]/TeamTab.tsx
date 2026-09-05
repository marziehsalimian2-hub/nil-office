"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { addMember, removeMember } from "@/app/actions/project-members";
import { Field, FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { PROJECT_MEMBER_ROLE, PROJECT_MEMBER_ROLE_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };
type MemberRow = { id: string; user_id: string; userName: string; role: string };

export function TeamTab({ projectId, profiles, members }: { projectId: string; profiles: Opt[]; members: MemberRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addMember(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    if (!confirm("حذف این عضو از تیم؟")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("project_id", projectId);
    startTransition(async () => {
      await removeMember(null, fd);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">تیم پروژه</p>
        {!adding && (
          <button type="button" className="btn-quiet gap-1.5 p-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> افزودن عضو
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-paper-line bg-paper/40 p-4">
          <input type="hidden" name="project_id" value={projectId} />
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="کاربر" required>
              <select name="user_id" required className="input" defaultValue="">
                <option value="">— انتخاب —</option>
                {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
              </select>
            </Field>
            <Field label="نقش">
              <select name="role" className="input" defaultValue="MEMBER">
                {PROJECT_MEMBER_ROLE.map((r) => (<option key={r} value={r}>{PROJECT_MEMBER_ROLE_LABEL[r]}</option>))}
              </select>
            </Field>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">افزودن</button>
            <button type="button" disabled={pending} className="btn-quiet" onClick={() => setAdding(false)}>انصراف</button>
          </div>
        </form>
      )}
      {members.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">هنوز عضوی به تیم اضافه نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1">
                <p className="text-sm text-ink">{m.userName}</p>
                <p className="text-xs text-ink-muted">{PROJECT_MEMBER_ROLE_LABEL[m.role as keyof typeof PROJECT_MEMBER_ROLE_LABEL] ?? m.role}</p>
              </div>
              <button type="button" disabled={pending} className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف" onClick={() => remove(m.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

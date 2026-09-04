"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateProfileNameTitle } from "@/app/actions/profile";

export function UserNameTitleEdit({
  userId,
  fullName,
  title,
}: {
  userId: string;
  fullName: string | null;
  title: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string>();

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <div>
          <p className="text-ink">{fullName || "—"}</p>
          <p className="text-xs text-ink-muted" dir="ltr">{title || "—"}</p>
        </div>
        <button type="button" className="btn-quiet p-1" onClick={() => setEditing(true)} aria-label="ویرایش نام">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateProfileNameTitle(null, fd);
      if (res && "error" in res && res.error) setErr(res.error);
      else {
        setErr(undefined);
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1">
      <input type="hidden" name="user_id" value={userId} />
      <input name="full_name" defaultValue={fullName ?? ""} placeholder="نام" required className="input !py-1 text-sm" />
      <input name="title" defaultValue={title ?? ""} placeholder="سمت" dir="ltr" className="input !py-1 text-sm" />
      {err && <p className="text-xs text-status-cancelled">{err}</p>}
      <div className="flex gap-1">
        <button type="submit" disabled={pending} className="btn-quiet !py-1 text-xs">
          {pending ? "..." : "ذخیره"}
        </button>
        <button type="button" disabled={pending} className="btn-quiet !py-1 text-xs" onClick={() => setEditing(false)}>
          انصراف
        </button>
      </div>
    </form>
  );
}

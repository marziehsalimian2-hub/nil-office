"use client";
import { useActionState } from "react";
import { postJournal, reverseJournal, type ActionState } from "@/app/actions/accounting";
import { FormError } from "@/components/form";
export function JournalActions({ id, status }: { id: string; status: string }) {
  const [postState, postAction] = useActionState<ActionState, FormData>(postJournal, null);
  const [revState, revAction] = useActionState<ActionState, FormData>(reverseJournal, null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {status === "DRAFT" && (
          <form action={postAction}><input type="hidden" name="id" value={id} />
            <button className="btn-primary">ثبت قطعی سند</button>
          </form>
        )}
        {status === "POSTED" && (
          <form action={revAction} onSubmit={(e) => { if (!confirm("برای این سند، سند برگشت صادر شود؟")) e.preventDefault(); }}>
            <input type="hidden" name="id" value={id} />
            <button className="btn-ghost text-status-cancelled">صدور سند برگشت</button>
          </form>
        )}
      </div>
      <FormError message={postState?.error || revState?.error} />
    </div>
  );
}

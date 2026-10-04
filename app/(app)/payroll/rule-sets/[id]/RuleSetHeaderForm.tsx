"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateLegalRuleSetHeader } from "@/app/actions/payroll-rules";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";

export function RuleSetHeaderForm({
  id, effectiveFrom, effectiveTo, sourceReference,
}: { id: string; effectiveFrom: string; effectiveTo: string | null; sourceReference: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", id);
    start(async () => {
      const r = await updateLegalRuleSetHeader(null, fd);
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(undefined);
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn-quiet !py-1 text-xs" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> ویرایش بازه و منبع
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="معتبر از" required><JalaliDateInput name="effective_from" required defaultISO={effectiveFrom} /></Field>
        <Field label="معتبر تا پیش از"><JalaliDateInput name="effective_to" defaultISO={effectiveTo ?? undefined} /></Field>
      </div>
      <Field label="منبع / مرجع قانونی"><input name="source_reference" className="input" defaultValue={sourceReference ?? ""} /></Field>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary !py-1.5 text-xs">{pending ? "در حال ذخیره…" : "ذخیره"}</button>
        <button type="button" className="btn-quiet !py-1.5 text-xs" onClick={() => setOpen(false)}>انصراف</button>
      </div>
    </form>
  );
}

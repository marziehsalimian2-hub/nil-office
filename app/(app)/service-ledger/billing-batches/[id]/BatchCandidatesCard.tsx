"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBillingBatchItems } from "@/app/actions/billing-batches";
import { FormError } from "@/components/form";
import { Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";

export type Candidate = { source_type: "SERVICE_ENTRY" | "TIME_ENTRY" | "EXPENSE"; source_id: string; description: string; amount: number };

export function BatchCandidatesCard({ batchId, candidates }: { batchId: string; candidates: Candidate[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const key = (c: Candidate) => `${c.source_type}:${c.source_id}`;
  function toggle(c: Candidate) {
    setChecked((prev) => {
      const next = new Set(prev);
      const k = key(c);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function submit() {
    const refs = candidates.filter((c) => checked.has(key(c))).map((c) => ({ source_type: c.source_type, source_id: c.source_id }));
    if (refs.length === 0) return;
    const fd = new FormData();
    fd.append("batch_id", batchId);
    fd.append("refs", JSON.stringify(refs));
    startTransition(async () => {
      const res = await addBillingBatchItems(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setChecked(new Set());
        router.refresh();
      }
    });
  }

  if (candidates.length === 0) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">ردیف‌های آمادهٔ افزودن</p>
        <p className="mt-2 text-sm text-ink-muted">
          هیچ خدمت، زمان یا هزینه‌ای با وضعیت «آمادهٔ صورتحساب» برای این مشتری پیدا نشد. ابتدا از تب «خدمات» شرکت، موارد موردنظر را آمادهٔ صورتحساب کنید.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">ردیف‌های آمادهٔ افزودن</p>
      <FormError message={error} />
      <ul className="mb-3 divide-y divide-paper-line/60">
        {candidates.map((c) => (
          <li key={key(c)} className="flex items-center gap-3 py-2">
            <input type="checkbox" checked={checked.has(key(c))} onChange={() => toggle(c)} className="h-4 w-4 accent-[#9a6a2e]" />
            <span className="flex-1 text-sm text-ink">{c.description}</span>
            <span className="tnum text-sm text-ink-muted">{formatMoney(c.amount)}</span>
          </li>
        ))}
      </ul>
      <button type="button" disabled={pending || checked.size === 0} className="btn-primary" onClick={submit}>
        {pending ? "در حال افزودن…" : `افزودن ${checked.size > 0 ? checked.size : ""} ردیف`}
      </button>
    </Card>
  );
}

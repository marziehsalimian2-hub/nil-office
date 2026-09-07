"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, Pencil } from "lucide-react";
import { publishTradeOffer, setTradeOfferStatus, type ActionState } from "@/app/actions/trade";
import { FormError } from "@/components/form";
import type { TradeOfferStatus } from "@/lib/enums";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function DetailActions({ id, status, canApprove }: { id: string; status: TradeOfferStatus; canApprove: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(action: Action, fields: Record<string, string>) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <Link href={`/trade/${id}/edit`} className="btn-ghost">
            <Pencil className="h-4 w-4" /> ویرایش
          </Link>
        )}

        {status === "DRAFT" && canApprove && (
          <button disabled={pending} className="btn-seal" onClick={() => run(publishTradeOffer, { id })}>
            <CheckCircle2 className="h-4 w-4" /> انتشار آفر
          </button>
        )}

        {["ACTIVE", "EXPIRED"].includes(status) && canApprove && (
          <>
            <button disabled={pending} className="btn-ghost" onClick={() => {
              if (confirm("آیا از بستن این آفر مطمئن هستید؟")) run(setTradeOfferStatus, { id, status: "CLOSED" });
            }}>
              بستن آفر
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => {
              if (confirm("آیا از لغو این آفر مطمئن هستید؟")) run(setTradeOfferStatus, { id, status: "CANCELLED" });
            }}>
              <XCircle className="h-4 w-4" /> لغو آفر
            </button>
          </>
        )}
      </div>
    </div>
  );
}

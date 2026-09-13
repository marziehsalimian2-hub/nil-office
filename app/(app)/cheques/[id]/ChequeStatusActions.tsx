"use client";

import { useActionState, useState } from "react";
import {
  prepareCheque,
  issueCheque,
  deliverCheque,
  receiveCheque,
  depositCheque,
  clearCheque,
  markChequeReturned,
  voidCheque,
  cancelCheque,
  type ActionState,
} from "@/app/actions/cheques";
import { FormError, SubmitButton } from "@/components/form";

type Direction = "PAYABLE" | "RECEIVABLE";
type Transition = { action: keyof typeof ACTION_FN; label: string; needsReason?: boolean; variant?: "primary" | "ghost" };

const ACTION_FN = {
  prepare: prepareCheque,
  issue: issueCheque,
  deliver: deliverCheque,
  receive: receiveCheque,
  deposit: depositCheque,
  clear: clearCheque,
  returned: markChequeReturned,
  void: voidCheque,
  cancel: cancelCheque,
} as const;

const TRANSITIONS: Record<Direction, Record<string, Transition[]>> = {
  PAYABLE: {
    DRAFT: [
      { action: "prepare", label: "آماده‌سازی برای چاپ", variant: "primary" },
      { action: "cancel", label: "لغو" },
    ],
    PREPARED: [
      { action: "issue", label: "صدور", variant: "primary" },
      { action: "cancel", label: "لغو" },
      { action: "void", label: "ابطال (برگهٔ خراب/اشتباه)", needsReason: true },
    ],
    ISSUED: [
      { action: "deliver", label: "تحویل به ذی‌نفع", variant: "primary" },
      { action: "returned", label: "برگشت خورد", needsReason: true },
      { action: "void", label: "ابطال", needsReason: true },
    ],
    DELIVERED: [
      { action: "clear", label: "وصول شد", variant: "primary" },
      { action: "returned", label: "برگشت خورد", needsReason: true },
      { action: "void", label: "ابطال", needsReason: true },
    ],
  },
  RECEIVABLE: {
    DRAFT: [
      { action: "receive", label: "دریافت فیزیکی چک", variant: "primary" },
      { action: "cancel", label: "لغو" },
    ],
    RECEIVED: [
      { action: "deposit", label: "تودیع به بانک", variant: "primary" },
      { action: "cancel", label: "لغو" },
    ],
    DEPOSITED: [
      { action: "clear", label: "وصول شد", variant: "primary" },
      { action: "returned", label: "برگشت خورد (بی‌محل)", needsReason: true },
    ],
  },
};

function TransitionButton({ chequeId, transition }: { chequeId: string; transition: Transition }) {
  const fn = ACTION_FN[transition.action];
  const [state, action] = useActionState<ActionState, FormData>(fn, null);
  const [showReason, setShowReason] = useState(false);

  if (transition.needsReason && !showReason) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setShowReason(true)}>
        {transition.label}
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={chequeId} />
      {transition.needsReason && <input name="reason" required placeholder="دلیل..." className="input w-48" />}
      <SubmitButton variant={transition.variant === "primary" ? "primary" : "ghost"}>{transition.label}</SubmitButton>
      {state?.error && <FormError message={state.error} />}
    </form>
  );
}

export function ChequeStatusActions({ chequeId, direction, status }: { chequeId: string; direction: Direction; status: string }) {
  const options = TRANSITIONS[direction]?.[status] ?? [];
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-3">
      {options.map((t) => (
        <TransitionButton key={t.action} chequeId={chequeId} transition={t} />
      ))}
    </div>
  );
}

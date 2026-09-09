"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

/**
 * Confirming/cancelling here calls /api/assistant/confirm DIRECTLY — no
 * LLM round-trip is involved in actually executing the write (plan
 * decision #5). This is the deterministic, code-driven confirmation
 * path; typing "باشه" in the chat input is the other one (handled
 * server-side in lib/assistant/orchestrator.ts, spec §19).
 */
export function ActionPreviewCard({ pendingActionId, previewText, onResolved }: { pendingActionId: string; previewText: string; onResolved: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  const [resolved, setResolved] = useState(false);

  async function decide(decision: "confirm" | "cancel") {
    setPending(true);
    try {
      const res = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_action_id: pendingActionId, decision }),
      });
      const json = await res.json();
      setResolved(true);
      if (decision === "cancel") onResolved("لغو شد.");
      else onResolved(json.ok ? "انجام شد. ثبت شد." : json.error ?? "عملیات ناموفق بود.");
    } catch {
      onResolved("خطا در ارتباط با سرور.");
      setResolved(true);
    } finally {
      setPending(false);
    }
  }

  if (resolved) return null;

  return (
    <div className="card border-seal/30 bg-seal/5 p-4">
      <p className="whitespace-pre-wrap text-sm text-ink">{previewText}</p>
      <div className="mt-3 flex gap-2">
        <button disabled={pending} onClick={() => decide("confirm")} className="btn-primary">
          <Check className="h-4 w-4" /> تأیید
        </button>
        <button disabled={pending} onClick={() => decide("cancel")} className="btn-ghost">
          <X className="h-4 w-4" /> لغو
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { QuickPrompts } from "./QuickPrompts";
import { ResultCardView } from "./ResultCardView";
import { ActionPreviewCard } from "./ActionPreviewCard";
import type { ResultCard } from "@/lib/assistant/actions/types";

type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; cards: ResultCard[]; pendingAction: { id: string; previewText: string } | null }
  | { kind: "system"; text: string };

/**
 * No streaming in v1 (plan decision #10) — one POST per turn, a loading
 * state while it's in flight. The LLM loop and confirmation round-trip
 * need a live Anthropic API key + a live Supabase project to actually
 * exercise; this component itself has no mocked/fake data path — it
 * always talks to the real /api/assistant/chat route.
 */
export function ChatPanel() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    setEntries((prev) => [...prev, { kind: "user", text: message }]);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "خطایی رخ داد.");
        return;
      }
      setConversationId(json.conversation_id);
      setEntries((prev) => [...prev, { kind: "assistant", text: json.text, cards: json.cards ?? [], pendingAction: json.pendingAction ?? null }]);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  function onActionResolved(entryIndex: number, message: string) {
    setEntries((prev) => [...prev, { kind: "system", text: message }]);
  }

  return (
    <div className="flex h-[70vh] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-paper-line bg-paper p-4">
        {entries.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">یکی از پرسش‌های زیر را انتخاب کنید یا سؤال خودتان را بنویسید:</p>
            <QuickPrompts onPick={send} />
          </div>
        )}
        {entries.map((e, i) => {
          if (e.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-xl bg-seal px-3.5 py-2 text-sm text-white">{e.text}</div>
              </div>
            );
          }
          if (e.kind === "system") {
            return (
              <p key={i} className="text-center text-xs text-ink-muted">
                {e.text}
              </p>
            );
          }
          return (
            <div key={i} className="max-w-[85%] space-y-2">
              <div className="rounded-xl bg-paper-card px-3.5 py-2 text-sm text-ink">{e.text}</div>
              {e.cards.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {e.cards.map((c) => (
                    <ResultCardView key={`${c.kind}-${c.id}`} card={c} />
                  ))}
                </div>
              )}
              {e.pendingAction && <ActionPreviewCard pendingActionId={e.pendingAction.id} previewText={e.pendingAction.previewText} onResolved={(m) => onActionResolved(i, m)} />}
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> در حال فکر کردن…
          </div>
        )}
        {error && <p className="text-sm text-status-cancelled">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="پیام خود را بنویسید…" className="input flex-1" disabled={loading} />
        <button type="submit" disabled={loading || !input.trim()} className="btn-primary">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

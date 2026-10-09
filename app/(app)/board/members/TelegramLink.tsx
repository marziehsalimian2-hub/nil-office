"use client";

import { useActionState, useState, startTransition } from "react";
import { Copy, Check, Send } from "lucide-react";
import { issueTelegramLink, unlinkTelegram, type BoardActionState } from "@/app/actions/board";
import { boardDateTime } from "@/lib/board/time";

/** Telegram status of one member + «ساخت لینک اتصال» (shown once) + «قطع اتصال». */
export function TelegramLink({ memberId, linkedAt, canManage, isActive }: { memberId: string; linkedAt: string | null; canManage: boolean; isActive: boolean }) {
  const [issued, issue, issuing] = useActionState<BoardActionState, FormData>(issueTelegramLink, null);
  const [unlinked, unlink, unlinking] = useActionState<BoardActionState, FormData>(unlinkTelegram, null);
  const [copied, setCopied] = useState(false);
  const fd = () => { const f = new FormData(); f.append("member_id", memberId); return f; };

  return (
    <div className="mt-2 rounded-lg bg-paper px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Send className="h-3.5 w-3.5 text-ink-muted" />
        {linkedAt ? <span className="text-status-final">تلگرام وصل است — از {boardDateTime(linkedAt)}</span> : <span className="text-ink-muted">تلگرام وصل نیست</span>}
        {canManage && isActive && (
          <button type="button" disabled={issuing} className="btn-ghost !px-2 !py-1 text-xs" onClick={() => startTransition(() => issue(fd()))}>
            {issuing ? "…" : linkedAt ? "لینک اتصال جدید" : "ساخت لینک اتصال"}
          </button>
        )}
        {canManage && linkedAt && (
          <button type="button" disabled={unlinking} className="btn-ghost !px-2 !py-1 text-xs text-status-cancelled"
            onClick={() => { if (window.confirm("اتصال تلگرام این عضو قطع شود؟")) startTransition(() => unlink(fd())); }}>
            {unlinking ? "…" : "قطع اتصال"}
          </button>
        )}
      </div>
      {issued?.link && (
        <div className="mt-2">
          <p className="mb-1 text-ink-muted">این لینک را فقط برای خود این عضو بفرستید (یک‌بارمصرف، ۷ روز اعتبار). پس از بستن صفحه دوباره نمایش داده نمی‌شود.</p>
          <div className="flex items-center gap-2">
            <input readOnly dir="ltr" value={issued.link} className="input !py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn-ghost !px-2 !py-1" onClick={async () => { await navigator.clipboard.writeText(issued.link!); setCopied(true); }}>
              {copied ? <Check className="h-3.5 w-3.5 text-status-final" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
      {(issued?.error || unlinked?.error) && <p className="mt-1 text-status-cancelled">{issued?.error ?? unlinked?.error}</p>}
      {unlinked?.ok && <p className="mt-1 text-status-final">{unlinked.message}</p>}
    </div>
  );
}

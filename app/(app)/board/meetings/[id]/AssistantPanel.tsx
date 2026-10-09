import { Sparkles, AlertTriangle, Quote } from "lucide-react";
import { Card } from "@/components/ui";
import { Field } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { toFaDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { boardDateTime } from "@/lib/board/time";
import type { BoardSuggestion } from "@/lib/board/assistant/normalize";
import type { BoardMember } from "@/lib/board/types";
import { applyBoardDraft, discardBoardDraft, generateBoardDraft } from "@/app/actions/board-assistant";
import { BoardButton, BoardForm } from "../../BoardForm";

export type PendingDraft = { id: string; source: "WEB" | "TELEGRAM"; created_at: string; suggestion: BoardSuggestion };

function SourceQuote({ quote, found }: { quote: string; found: boolean }) {
  if (!quote) return <p className="mt-1 flex items-center gap-1 text-xs text-status-cancelled"><AlertTriangle className="h-3 w-3" /> بدون ارجاع به یادداشت‌ها</p>;
  return (
    <details className="mt-1 text-xs">
      <summary className={cn("flex cursor-pointer items-center gap-1", found ? "text-ink-muted" : "text-status-cancelled")}>
        {found ? <Quote className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {found ? "مبنا در یادداشت‌ها" : "این عبارت در یادداشت‌ها پیدا نشد — با دقت بررسی کنید"}
      </summary>
      <p className="mt-1 whitespace-pre-line rounded bg-paper px-2 py-1 text-ink-muted">{quote}</p>
    </details>
  );
}

/**
 * «دستیار پیش‌نویس» on a DRAFT meeting: notes (typed, pasted or phone-keyboard dictation — text only) → a suggestion; then a review form
 * where each item is ticked (default: ticked when its quote was found in the notes) and missing owners / deadlines are filled in by the
 * person. Nothing reaches the minutes until «اعمال موارد انتخاب‌شده».
 */
export function AssistantPanel({ meetingId, pending, members }: { meetingId: string; pending: PendingDraft | null; members: BoardMember[] }) {
  const active = members.filter((m) => m.is_active);
  if (!pending) {
    return (
      <Card className="mb-5 border-seal/30">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink"><Sparkles className="h-4 w-4 text-seal" /> دستیار پیش‌نویس</h2>
        <p className="mb-3 text-xs text-ink-muted">
          یادداشت‌های خام جلسه را اینجا بنویسید یا بچسبانید (برای گفتن به‌جای نوشتن، از دکمهٔ میکروفون کیبورد گوشی استفاده کنید). دستیار مذاکرات هر بند و
          مصوبات را مرتب پیشنهاد می‌دهد؛ تا شما تأیید نکنید چیزی به صورت‌جلسه اضافه نمی‌شود. مسئول و مهلت فقط وقتی پیشنهاد می‌شود که صریحاً در یادداشت‌ها آمده باشد.
        </p>
        <BoardForm action={generateBoardDraft} submitLabel="ساخت پیش‌نویس با دستیار" variant="seal">
          <input type="hidden" name="meeting_id" value={meetingId} />
          <textarea name="notes" rows={8} required maxLength={20000} className="input" placeholder={"مثلاً:\nبند ۱ قرارداد عمان — آقای حسینی گزارش داد، قرار شد پیشنهاد نهایی تا ۲۰ آبان آماده شود. مسئول: سامان حسینی.\nگزارش مالی شش‌ماهه با اتفاق آرا تصویب شد."} />
        </BoardForm>
      </Card>
    );
  }

  const s = pending.suggestion;
  return (
    <Card className="mb-5 border-seal/40">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink"><Sparkles className="h-4 w-4 text-seal" /> پیشنهاد دستیار — برای بررسی</h2>
      <p className="mb-3 text-xs text-ink-muted">
        ساخته‌شده در {boardDateTime(pending.created_at)} {pending.source === "TELEGRAM" ? "از یادداشت‌های ارسالی در ربات" : ""}. موارد را بخوانید، تیک موارد درست را نگه دارید و
        مسئول و مهلت مصوبات اجرایی را کامل کنید. مواردی که مبنایشان در یادداشت‌ها پیدا نشد، از پیش تیک ندارند.
      </p>

      {s.warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-status-waiting"><AlertTriangle className="h-3.5 w-3.5" /> نکاتی که دستیار مطمئن نبود</p>
          <ul className="list-disc space-y-0.5 pr-5 text-xs text-ink">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <BoardForm
        action={applyBoardDraft}
        submitLabel="اعمال موارد انتخاب‌شده"
        variant="seal"
        extra={<BoardButton action={discardBoardDraft} fields={{ draft_id: pending.id }} label="رد کل پیشنهاد" confirmText="این پیشنهاد کنار گذاشته شود؟" className="text-status-cancelled" />}
      >
        <input type="hidden" name="draft_id" value={pending.id} />

        {s.general_notes && (
          <label className="mb-3 block rounded-lg border border-paper-line p-3">
            <span className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" name="apply_general" defaultChecked className="h-4 w-4" /> مقدمه / خلاصهٔ کلی</span>
            <p className="mt-1 whitespace-pre-line text-sm text-ink">{s.general_notes}</p>
          </label>
        )}

        {s.agenda.length > 0 && <p className="mb-2 mt-4 text-xs font-semibold text-ink-muted">مذاکرات بندها</p>}
        <div className="space-y-3">
          {s.agenda.map((a) => (
            <div key={a.key} className="rounded-lg border border-paper-line p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input type="checkbox" name={`agenda_${a.key}`} defaultChecked={a.quote_found} className="h-4 w-4" />
                {a.agenda_item_id ? a.title : <>بند جدید: {a.title} <span className="text-xs font-normal text-seal">(پیشنهاد افزودن)</span></>}
              </label>
              <p className="mt-1 whitespace-pre-line text-sm text-ink">{a.discussion}</p>
              <SourceQuote quote={a.quote} found={a.quote_found} />
            </div>
          ))}
        </div>

        {s.resolutions.length > 0 && <p className="mb-2 mt-4 text-xs font-semibold text-ink-muted">مصوبات پیشنهادی</p>}
        <div className="space-y-3">
          {s.resolutions.map((r, i) => (
            <div key={r.key} className="rounded-lg border border-paper-line p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input type="checkbox" name={`res_${r.key}`} defaultChecked={r.quote_found} className="h-4 w-4" />
                مصوبهٔ {toFaDigits(i + 1)} {r.requires_action ? "" : <span className="text-xs font-normal text-ink-muted">(بدون اقدام اجرایی)</span>}
              </label>
              <textarea name={`res_${r.key}_text`} defaultValue={r.text} rows={2} className="input mt-2" />
              {r.vote_note && <p className="mt-1 border-r-2 border-seal pr-2 text-xs text-ink-muted">{r.vote_note}</p>}
              {r.requires_action && (
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <Field label="مسئول" hint={r.owner_hint && !r.owner_member_id ? `در یادداشت‌ها: «${r.owner_hint}»` : undefined}>
                    <select name={`res_${r.key}_owner`} defaultValue={r.owner_member_id ?? ""} className={cn("input", !r.owner_member_id && "border-status-waiting")}>
                      <option value="">— انتخاب کنید —</option>
                      {active.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.position_title ? ` — ${m.position_title}` : ""}</option>)}
                    </select>
                  </Field>
                  <Field label="مهلت" hint={r.due_hint && !r.due_date ? `در یادداشت‌ها: «${r.due_hint}»` : undefined}>
                    <JalaliDateInput name={`res_${r.key}_due`} defaultISO={r.due_date} />
                  </Field>
                  <Field label="خروجی مورد انتظار"><p className="pt-2 text-sm text-ink">{r.expected_output ?? "—"}</p></Field>
                </div>
              )}
              <SourceQuote quote={r.quote} found={r.quote_found} />
            </div>
          ))}
        </div>

        {s.remaining_topics && (
          <label className="mt-4 block rounded-lg border border-paper-line p-3">
            <span className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" name="apply_remaining" defaultChecked className="h-4 w-4" /> موضوعات باقی‌مانده</span>
            <p className="mt-1 whitespace-pre-line text-sm text-ink">{s.remaining_topics}</p>
          </label>
        )}
      </BoardForm>
    </Card>
  );
}

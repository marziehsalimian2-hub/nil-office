import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip, Send, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { Field } from "@/components/form";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { cn, formatBytes } from "@/lib/utils";
import { boardDateTime, tehranDate } from "@/lib/board/time";
import { BOARD_FOLLOW_STATUS_LABEL, boardAccess, type BoardFollowStatus } from "@/lib/board/types";
import { closeOrReopenResolution, reportResolutionProgress } from "@/app/actions/board";
import { BoardForm } from "../../BoardForm";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<BoardFollowStatus, string> = {
  OPEN: "status-draft", IN_PROGRESS: "status-sent", BLOCKED: "status-cancelled", PENDING_REVIEW: "status-waiting", DONE: "status-final", NO_ACTION: "status-closed",
};
const KIND_LABEL: Record<string, string> = { PROGRESS: "گزارش پیشرفت", CLOSED: "بسته شد", REOPENED: "بازگشایی" };

type Update = {
  id: string; kind: string; status: BoardFollowStatus; note: string; source: "WEB" | "TELEGRAM"; created_at: string;
  profile: { full_name: string | null } | null; member: { full_name: string } | null;
};
type FileRow = { id: string; update_id: string; storage_path: string; file_name: string; size_bytes: number };

export default async function BoardResolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const profile = await requireProfile();
  const access = boardAccess(profile);
  const supabase = await createClient();

  const { data: r } = await supabase
    .from("board_resolutions")
    .select("*, owner:board_members!board_resolutions_owner_member_id_fkey(full_name), meeting:board_meetings!inner(id, meeting_number, scheduled_at, status)")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const meeting = (Array.isArray(r.meeting) ? r.meeting[0] : r.meeting) as { id: string; meeting_number: number | null; scheduled_at: string; status: string };
  const owner = (Array.isArray(r.owner) ? r.owner[0] : r.owner) as { full_name: string } | null;
  const status = r.follow_status as BoardFollowStatus;
  const today = tehranDate(new Date())!;
  const overdue = r.requires_action && r.due_date && r.due_date < today && !["DONE", "NO_ACTION"].includes(status);
  const approved = meeting.status === "APPROVED";

  const [{ data: updData }, { data: fileData }] = await Promise.all([
    supabase
      .from("board_resolution_updates")
      .select("id, kind, status, note, source, created_at, profile:profiles!board_resolution_updates_actor_profile_id_fkey(full_name), member:board_members!board_resolution_updates_actor_member_id_fkey(full_name)")
      .eq("resolution_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("board_resolution_files").select("id, update_id, storage_path, file_name, size_bytes").eq("resolution_id", id),
  ]);
  const updates = (updData ?? []) as unknown as Update[];
  const files = (fileData ?? []) as FileRow[];
  // short-lived links with the viewer's own session (storage policy board_meeting/% = board access)
  const signed = new Map<string, string>();
  await Promise.all(files.map(async (f) => {
    const { data } = await supabase.storage.from("nil-files").createSignedUrl(f.storage_path, 300);
    if (data?.signedUrl) signed.set(f.id, data.signedUrl);
  }));
  const filesOf = (u: string) => files.filter((f) => f.update_id === u);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`مصوبهٔ ${r.resolution_number ? toFaDigits(r.resolution_number) : "—"}`}
        subtitle={`صورت‌جلسهٔ ${meeting.meeting_number ? toFaDigits(meeting.meeting_number) : "پیش‌نویس"}`}
        action={<Link href={`/board/meetings/${meeting.id}`} className="btn-ghost">صفحهٔ جلسه</Link>}
      />

      <Card className="mb-5">
        <p className="whitespace-pre-line text-sm leading-7 text-ink">{r.text}</p>
        {r.vote_note && <p className="mt-2 border-r-2 border-seal pr-2 text-xs text-ink-muted">{r.vote_note}</p>}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-ink-muted">مسئول</dt><dd className="text-ink">{owner?.full_name ?? "—"}</dd></div>
          <div><dt className="text-ink-muted">مهلت</dt><dd className={cn("tnum", overdue ? "font-medium text-status-cancelled" : "text-ink")}>{r.due_date ? formatJalali(r.due_date) : "—"}{overdue ? " (گذشته)" : ""}</dd></div>
          <div><dt className="text-ink-muted">خروجی مورد انتظار</dt><dd className="text-ink">{r.expected_output ?? "—"}</dd></div>
          <div><dt className="text-ink-muted">وضعیت</dt><dd><span className={cn("badge bg-paper", STATUS_TONE[status])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{BOARD_FOLLOW_STATUS_LABEL[status]}</span></dd></div>
        </dl>
      </Card>

      {approved && r.requires_action && access.create && status !== "DONE" && (
        <Card className="mb-5">
          <p className="mb-3 text-sm font-medium text-ink">ثبت گزارش پیشرفت</p>
          <div key={`progress-${updates.length}`}>
            <BoardForm action={reportResolutionProgress} submitLabel="ثبت گزارش" resetOnSuccess>
              <input type="hidden" name="resolution_id" value={r.id} />
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                <Field label="وضعیت" required>
                  <select name="status" defaultValue={status === "OPEN" ? "IN_PROGRESS" : status} className="input">
                    <option value="IN_PROGRESS">{BOARD_FOLLOW_STATUS_LABEL.IN_PROGRESS}</option>
                    <option value="BLOCKED">{BOARD_FOLLOW_STATUS_LABEL.BLOCKED}</option>
                    <option value="PENDING_REVIEW">انجام شد — منتظر بررسی</option>
                  </select>
                </Field>
                <Field label="توضیح" required><textarea name="note" rows={2} required className="input" /></Field>
              </div>
              <div className="mt-3"><Field label="فایل مستند (اختیاری، چند فایل)"><input type="file" name="files" multiple className="text-sm" /></Field></div>
            </BoardForm>
          </div>
        </Card>
      )}

      {approved && r.requires_action && access.approve && (
        <Card className="mb-5">
          <p className="mb-1 text-sm font-medium text-ink">{status === "DONE" ? "بازگشایی مصوبه" : "بستن مصوبه (تأیید انجام)"}</p>
          <p className="mb-3 text-xs text-ink-muted">{status === "DONE" ? "اگر کار نیاز به اقدام بیشتر دارد، با ذکر دلیل بازگشایی کنید." : "بستن فقط با تأیید دبیر انجام می‌شود؛ نتیجه را بنویسید. مسئول در تلگرام مطلع می‌شود."}</p>
          <div key={`close-${updates.length}`}>
            <BoardForm action={closeOrReopenResolution} submitLabel={status === "DONE" ? "بازگشایی" : "بستن مصوبه"} variant={status === "DONE" ? "ghost" : "seal"} resetOnSuccess>
              <input type="hidden" name="resolution_id" value={r.id} />
              <input type="hidden" name="action" value={status === "DONE" ? "reopen" : "close"} />
              <Field label={status === "DONE" ? "دلیل بازگشایی" : "نتیجه"} required><textarea name="note" rows={2} required className="input" /></Field>
            </BoardForm>
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">سابقهٔ پیگیری</p>
        {updates.length === 0 ? <p className="text-sm text-ink-muted">هنوز گزارشی ثبت نشده است.</p> : (
          <ol className="space-y-4">
            {updates.map((u) => (
              <li key={u.id} className="border-r-2 border-paper-line pr-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span className="font-medium text-ink">{KIND_LABEL[u.kind] ?? u.kind}</span>
                  <span>→ {BOARD_FOLLOW_STATUS_LABEL[u.status]}</span>
                  <span>·</span>
                  <span className="tnum">{boardDateTime(u.created_at)}</span>
                  <span>·</span>
                  <span>{u.member?.full_name ?? u.profile?.full_name ?? "—"}</span>
                  {u.source === "TELEGRAM"
                    ? <span className="inline-flex items-center gap-1"><Send className="h-3 w-3" /> تلگرام</span>
                    : <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> سامانه</span>}
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-ink">{u.note}</p>
                {filesOf(u.id).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {filesOf(u.id).map((f) => (
                      <li key={f.id} className="flex items-center gap-1 text-xs">
                        <Paperclip className="h-3 w-3 text-ink-muted" />
                        {signed.get(f.id) ? <a href={signed.get(f.id)} target="_blank" rel="noopener" className="text-seal hover:underline">{f.file_name}</a> : <span>{f.file_name}</span>}
                        <span className="text-ink-muted">({formatBytes(f.size_bytes)})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

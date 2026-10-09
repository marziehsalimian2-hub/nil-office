import { Card } from "@/components/ui";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { boardDate, boardDateTime, boardTime, boardWeekday } from "@/lib/board/time";
import {
  BOARD_ATTENDANCE_LABEL, BOARD_FOLLOW_STATUS_LABEL, BOARD_MEETING_TYPE_LABEL, quorumInfo, type MinutesDoc,
} from "@/lib/board/types";

const ATT_TONE = { PRESENT: "text-status-final", ABSENT: "text-status-cancelled", EXCUSED: "text-status-waiting" } as const;

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white tnum">{toFaDigits(n)}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

const Multiline = ({ text }: { text: string | null | undefined }) =>
  text ? <p className="whitespace-pre-line text-sm leading-7 text-ink">{text}</p> : <p className="text-sm text-ink-muted">—</p>;

/** Read-only minutes (approved snapshot, or a draft for VIEW-only users). Same 8 sections as the PDF. */
export function MinutesView({ doc }: { doc: MinutesDoc }) {
  const m = doc.meeting;
  const present = doc.attendance.filter((a) => a.status === "PRESENT").length;
  const q = quorumInfo(doc.attendance.length, present);
  return (
    <div>
      <Section n={1} title="مشخصات جلسه">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-muted">شماره و نوع</dt><dd className="text-ink">{m.number ? toFaDigits(m.number) : "—"} — {BOARD_MEETING_TYPE_LABEL[m.type]}</dd></div>
          <div><dt className="text-ink-muted">تاریخ</dt><dd className="text-ink tnum">{boardWeekday(m.scheduled_at)} {boardDate(m.scheduled_at)}</dd></div>
          <div><dt className="text-ink-muted">زمان برگزاری</dt><dd className="text-ink tnum">{m.started_at ? `${boardTime(m.started_at)} تا ${boardTime(m.ended_at)}` : "—"}</dd></div>
          <div><dt className="text-ink-muted">محل</dt><dd className="text-ink">{m.location}</dd></div>
          <div><dt className="text-ink-muted">رئیس جلسه</dt><dd className="text-ink">{doc.chair?.name ?? "—"}</dd></div>
          <div><dt className="text-ink-muted">دبیر جلسه</dt><dd className="text-ink">{doc.secretary?.name ?? "—"}</dd></div>
          {m.invitees && <div className="sm:col-span-2"><dt className="text-ink-muted">مدعوین</dt><dd className="whitespace-pre-line text-ink">{m.invitees}</dd></div>}
        </dl>
      </Section>

      <Section n={2} title="حضور و غیاب">
        <ul className="divide-y divide-paper-line text-sm">
          {doc.attendance.map((a) => (
            <li key={a.member_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-ink">{a.name}{a.title && <span className="text-ink-muted"> — {a.title}</span>}</span>
              <span className={cn("text-xs font-medium", ATT_TONE[a.status])}>{BOARD_ATTENDANCE_LABEL[a.status]}{a.note ? ` (${a.note})` : ""}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-muted">حاضران: {toFaDigits(present)} از {toFaDigits(doc.attendance.length)}{q.met ? " — حد نصاب اکثریت برقرار بود." : ""}</p>
      </Section>

      <Section n={3} title="دستور جلسه">
        <ol className="space-y-1 text-sm">
          {doc.agenda.map((a) => <li key={a.id} className="text-ink"><span className="ml-2 text-seal tnum">{toFaDigits(a.position)}.</span>{a.title}</li>)}
        </ol>
      </Section>

      {doc.previous_followups.length > 0 && (
        <Section n={4} title="مصوبات باز جلسات قبل (در زمان تأیید)">
          <ul className="divide-y divide-paper-line text-sm">
            {doc.previous_followups.map((r) => (
              <li key={r.number} className="py-2">
                <span className="ml-2 font-medium text-ink tnum">{toFaDigits(r.number)}</span>{r.text}
                <span className="mr-2 text-xs text-ink-muted">— {r.owner_name ?? "—"} — {r.due_date ? formatJalali(r.due_date) : "—"} — {BOARD_FOLLOW_STATUS_LABEL[r.follow_status]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section n={5} title="خلاصهٔ مذاکرات">
        {m.general_notes && <div className="mb-3"><Multiline text={m.general_notes} /></div>}
        {doc.agenda.filter((a) => a.discussion?.trim()).map((a) => (
          <div key={a.id} className="mb-3">
            <p className="mb-1 text-sm font-medium text-ink">بند {toFaDigits(a.position)} — {a.title}</p>
            <Multiline text={a.discussion} />
          </div>
        ))}
      </Section>

      <Section n={6} title="مصوبات">
        {doc.resolutions.length === 0 ? <p className="text-sm text-ink-muted">مصوبه‌ای ثبت نشد.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="table-head">
                <th className="px-3 py-2">شماره</th><th className="px-3 py-2">متن</th><th className="px-3 py-2">مسئول</th>
                <th className="px-3 py-2">مهلت</th><th className="px-3 py-2">خروجی</th>
              </tr></thead>
              <tbody>
                {doc.resolutions.map((r, i) => (
                  <tr key={r.id} className="table-row align-top">
                    <td className="px-3 py-2 tnum font-medium text-ink">{r.number ? toFaDigits(r.number) : toFaDigits(i + 1)}</td>
                    <td className="px-3 py-2 text-ink">
                      <span className="whitespace-pre-line">{r.text}</span>
                      {r.vote_note && <p className="mt-1 border-r-2 border-seal pr-2 text-xs text-ink-muted">{r.vote_note}</p>}
                    </td>
                    {r.requires_action ? (
                      <>
                        <td className="px-3 py-2 text-ink-muted">{r.owner_name ?? "—"}</td>
                        <td className="px-3 py-2 tnum text-ink-muted">{r.due_date ? formatJalali(r.due_date) : "—"}</td>
                        <td className="px-3 py-2 text-ink-muted">{r.expected_output ?? "—"}</td>
                      </>
                    ) : <td colSpan={3} className="px-3 py-2 text-center text-xs text-ink-muted">بدون اقدام اجرایی</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section n={7} title="موضوعات باقی‌مانده و جلسهٔ بعد">
        <Multiline text={m.remaining_topics} />
        {doc.next_meeting && <p className="mt-2 text-sm text-ink">جلسهٔ بعد (پیشنهادی): {boardDateTime(doc.next_meeting.scheduled_at)} — {doc.next_meeting.location}</p>}
      </Section>

      {doc.approved_at && (
        <p className="text-xs text-ink-muted">
          تأییدشده در {boardDateTime(doc.approved_at)}{doc.approved_by_name ? ` توسط ${doc.approved_by_name}` : ""}. نسخهٔ چاپی به امضای اعضای حاضر می‌رسد.
        </p>
      )}
    </div>
  );
}

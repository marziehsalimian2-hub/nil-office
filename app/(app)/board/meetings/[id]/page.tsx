import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, FileDown, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { Field } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { VerificationCard } from "@/components/VerificationCard";
import { toFaDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { addDays, boardDate, boardWeekday, tehranDate, tehranTime } from "@/lib/board/time";
import { approvalReadiness } from "@/lib/board/readiness";
import { loadMinutesDoc } from "@/lib/pdf/boardMinutesData";
import {
  BOARD_ATTENDANCE_LABEL, BOARD_ATTENDANCE_STATUS, BOARD_MEETING_TYPE, BOARD_MEETING_TYPE_LABEL, boardAccess,
  type BoardAgendaItem, type BoardAttendance, type BoardMember, type BoardResolution,
} from "@/lib/board/types";
import {
  approveBoardMeeting, deleteAgendaItem, deleteBoardMeeting, deleteResolution, saveAgendaItem, saveAttendance, saveResolution, updateBoardMeeting,
} from "@/app/actions/board";
import { BoardButton, BoardForm } from "../../BoardForm";
import { MinutesView } from "./MinutesView";

export const dynamic = "force-dynamic";

function EditorSection({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white tnum">{toFaDigits(n)}</span>
          {title}
        </h2>
        {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

const memberLabel = (m: BoardMember) => `${m.full_name}${m.position_title ? ` — ${m.position_title}` : ""}${m.is_active ? "" : " (غیرفعال)"}`;

export default async function BoardMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const profile = await requireProfile();
  const access = boardAccess(profile);
  const supabase = await createClient();

  let loaded: Awaited<ReturnType<typeof loadMinutesDoc>>;
  try {
    loaded = await loadMinutesDoc(supabase, id);
  } catch {
    notFound();
  }
  const { meeting: m, doc } = loaded;
  const pdfHref = `/api/board/${m.id}/pdf`;

  /* ----------------------------- APPROVED: read-only ----------------------------- */
  if (m.status === "APPROVED" || !access.create) {
    return (
      <div>
        <PageHeader
          title={m.meeting_number ? `صورت‌جلسهٔ شمارهٔ ${toFaDigits(m.meeting_number)}` : "پیش‌نویس جلسهٔ هیئت‌مدیره"}
          subtitle={`${boardWeekday(m.scheduled_at)} ${boardDate(m.scheduled_at)} — ${m.location}`}
          action={
            <div className="flex flex-wrap gap-2">
              <a href={pdfHref} target="_blank" rel="noopener" className="btn-seal"><FileDown className="h-4 w-4" /> {m.status === "APPROVED" ? "PDF صورت‌جلسه" : "پیش‌نمایش PDF"}</a>
              {m.next_meeting_id && <Link href={`/board/meetings/${m.next_meeting_id}`} className="btn-ghost">جلسهٔ بعد</Link>}
            </div>
          }
        />
        {m.status === "APPROVED" && (
          <>
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-status-final/30 bg-status-final/5 px-3 py-2 text-sm text-status-final">
              <Lock className="h-4 w-4" /> این صورت‌جلسه تأیید و قفل شده است؛ متن، حضور و مصوبات آن دیگر تغییر نمی‌کند.
            </div>
            <VerificationCard type="BOARD_MINUTES" documentId={m.id} isAdmin={profile.role === "ADMIN"} revalidate={`/board/meetings/${m.id}`} />
          </>
        )}
        <MinutesView doc={doc} />
      </div>
    );
  }

  /* ----------------------------- DRAFT: editor ----------------------------- */
  const [membersRes, attRes, agendaRes, resRes] = await Promise.all([
    supabase.from("board_members").select("*").order("sort_order").order("full_name"),
    supabase.from("board_attendance").select("*").eq("meeting_id", m.id),
    supabase.from("board_agenda_items").select("*").eq("meeting_id", m.id).order("position").order("created_at"),
    supabase.from("board_resolutions").select("*").eq("meeting_id", m.id).order("position").order("created_at"),
  ]);
  const members = (membersRes.data ?? []) as BoardMember[];
  const attendance = (attRes.data ?? []) as BoardAttendance[];
  const agenda = (agendaRes.data ?? []) as BoardAgendaItem[];
  const resolutions = (resRes.data ?? []) as BoardResolution[];
  const attByMember = new Map(attendance.map((a) => [a.member_id, a]));
  const rollCall = members.filter((x) => x.is_active || attByMember.has(x.id));
  const selectable = (current: string | null) => members.filter((x) => x.is_active || x.id === current);
  const readiness = approvalReadiness({ meeting: m, members, attendance, agenda, resolutions });

  const date = tehranDate(m.scheduled_at) ?? "";
  const time = tehranTime(m.scheduled_at) ?? "";
  const nextSuggestion = addDays(m.scheduled_at, 14);
  const nextAgendaPos = (agenda.at(-1)?.position ?? 0) + 1;
  const nextResPos = (resolutions.at(-1)?.position ?? 0) + 1;

  return (
    <div>
      <PageHeader
        title="پیش‌نویس جلسهٔ هیئت‌مدیره"
        subtitle={`${boardWeekday(m.scheduled_at)} ${boardDate(m.scheduled_at)} — ${m.location} — شماره پس از تأیید نهایی صادر می‌شود`}
        action={
          <div className="flex flex-wrap items-start gap-2">
            <a href={pdfHref} target="_blank" rel="noopener" className="btn-ghost"><FileDown className="h-4 w-4" /> پیش‌نمایش PDF</a>
            <BoardButton action={deleteBoardMeeting} fields={{ meeting_id: m.id }} label="حذف پیش‌نویس" confirmText="این پیش‌نویس با همهٔ بندها و مصوبات آن حذف شود؟" className="text-status-cancelled" />
          </div>
        }
      />

      {members.length === 0 && (
        <Card className="mb-5 border-status-waiting/40">
          <p className="text-sm text-ink">هنوز عضوی برای هیئت‌مدیره ثبت نشده است. ابتدا از <Link href="/board/members" className="text-seal underline">اعضا و تنظیمات</Link> اعضا را اضافه کنید.</p>
        </Card>
      )}

      {/* 1. meeting details */}
      <EditorSection n={1} title="مشخصات جلسه" hint="ساعت‌ها به وقت تهران است. ساعت واقعی شروع و پایان را بعد از برگزاری وارد کنید.">
        <BoardForm action={updateBoardMeeting} submitLabel="ذخیرهٔ مشخصات">
          <input type="hidden" name="meeting_id" value={m.id} />
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="تاریخ" required><JalaliDateInput name="date" defaultISO={date} required /></Field>
            <Field label="ساعت دعوت" required><input name="time" defaultValue={time} required dir="ltr" className="input text-center tnum" /></Field>
            <Field label="شروع واقعی"><input name="started_time" defaultValue={tehranTime(m.started_at) ?? ""} dir="ltr" placeholder="09:35" className="input text-center tnum" /></Field>
            <Field label="پایان واقعی"><input name="ended_time" defaultValue={tehranTime(m.ended_at) ?? ""} dir="ltr" placeholder="11:00" className="input text-center tnum" /></Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <Field label="نوع جلسه" required>
              <select name="meeting_type" defaultValue={m.meeting_type} className="input">
                {BOARD_MEETING_TYPE.map((t) => <option key={t} value={t}>{BOARD_MEETING_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-3"><Field label="محل یا شیوهٔ برگزاری" required><input name="location" defaultValue={m.location} required className="input" /></Field></div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="رئیس جلسه">
              <select name="chair_member_id" defaultValue={m.chair_member_id ?? ""} className="input"><option value="">—</option>
                {selectable(m.chair_member_id).map((x) => <option key={x.id} value={x.id}>{memberLabel(x)}</option>)}
              </select>
            </Field>
            <Field label="دبیر جلسه">
              <select name="secretary_member_id" defaultValue={m.secretary_member_id ?? ""} className="input"><option value="">—</option>
                {selectable(m.secretary_member_id).map((x) => <option key={x.id} value={x.id}>{memberLabel(x)}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-4"><Field label="مدعوین (غیر از اعضا)"><input name="invitees" defaultValue={m.invitees ?? ""} className="input" placeholder="مثلاً: مدیر مالی، مشاور حقوقی" /></Field></div>
          <div className="mt-4"><Field label="مقدمه / خلاصهٔ کلی مذاکرات" hint="اختیاری؛ مذاکرات هر بند را در بخش دستور جلسه بنویسید."><textarea name="general_notes" defaultValue={m.general_notes ?? ""} rows={3} className="input" /></Field></div>
          <div className="mt-4"><Field label="موضوعات باقی‌مانده"><textarea name="remaining_topics" defaultValue={m.remaining_topics ?? ""} rows={2} className="input" /></Field></div>
        </BoardForm>
      </EditorSection>

      {/* 2. attendance */}
      <EditorSection n={2} title="حضور و غیاب" hint="وضعیت همهٔ اعضای فعال باید مشخص شود؛ رئیس و دبیر جلسه باید حاضر باشند.">
        {rollCall.length === 0 ? <p className="text-sm text-ink-muted">عضو فعالی وجود ندارد.</p> : (
          <BoardForm action={saveAttendance} submitLabel="ذخیرهٔ حضور و غیاب">
            <input type="hidden" name="meeting_id" value={m.id} />
            <div className="divide-y divide-paper-line">
              {rollCall.map((x) => {
                const a = attByMember.get(x.id);
                return (
                  <div key={x.id} className="grid items-center gap-2 py-2 sm:grid-cols-[1fr_10rem_1fr]">
                    <span className="text-sm text-ink">{memberLabel(x)}{x.kind === "EXTERNAL" && <span className="mr-1 text-xs text-ink-muted">(بیرونی)</span>}</span>
                    <select name={`status_${x.id}`} defaultValue={a?.status ?? ""} className="input !py-1.5 text-sm">
                      <option value="">— تعیین نشده —</option>
                      {BOARD_ATTENDANCE_STATUS.map((s) => <option key={s} value={s}>{BOARD_ATTENDANCE_LABEL[s]}</option>)}
                    </select>
                    <input name={`note_${x.id}`} defaultValue={a?.note ?? ""} placeholder="توضیح (اختیاری)" className="input !py-1.5 text-sm" />
                  </div>
                );
              })}
            </div>
          </BoardForm>
        )}
      </EditorSection>

      {/* 3. agenda + discussion */}
      <EditorSection n={3} title="دستور جلسه و مذاکرات" hint="برای هر بند، خلاصهٔ مذاکرات و جمع‌بندی را بنویسید.">
        <div className="space-y-4">
          {agenda.map((a) => (
            <div key={a.id} className="rounded-lg border border-paper-line p-3">
              <BoardForm
                action={saveAgendaItem}
                submitLabel="ذخیرهٔ بند"
                variant="ghost"
                extra={<BoardButton action={deleteAgendaItem} fields={{ meeting_id: m.id, id: a.id }} label="حذف بند" confirmText="این بند حذف شود؟ مصوبات وابسته بدون بند می‌مانند." className="text-status-cancelled" />}
              >
                <input type="hidden" name="meeting_id" value={m.id} />
                <input type="hidden" name="id" value={a.id} />
                <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
                  <Field label="ردیف"><input name="position" type="number" min={1} max={500} defaultValue={a.position} className="input text-center tnum" /></Field>
                  <Field label="عنوان بند" required><input name="title" defaultValue={a.title} required className="input" /></Field>
                </div>
                <div className="mt-3"><Field label="خلاصهٔ مذاکرات و جمع‌بندی"><textarea name="discussion" defaultValue={a.discussion ?? ""} rows={4} className="input" /></Field></div>
              </BoardForm>
            </div>
          ))}
          <div key={`new-agenda-${agenda.length}`} className="rounded-lg border border-dashed border-paper-line p-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">افزودن بند جدید</p>
            <BoardForm action={saveAgendaItem} submitLabel="افزودن بند" resetOnSuccess>
              <input type="hidden" name="meeting_id" value={m.id} />
              <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
                <Field label="ردیف"><input name="position" type="number" min={1} max={500} defaultValue={nextAgendaPos} className="input text-center tnum" /></Field>
                <Field label="عنوان بند" required><input name="title" required className="input" placeholder="مثلاً: بررسی صورت‌های مالی شش‌ماهه" /></Field>
              </div>
              <div className="mt-3"><Field label="خلاصهٔ مذاکرات (می‌توانید بعداً بنویسید)"><textarea name="discussion" rows={2} className="input" /></Field></div>
            </BoardForm>
          </div>
        </div>
      </EditorSection>

      {/* 4. resolutions */}
      <EditorSection n={4} title="مصوبات" hint="مصوبهٔ اجرایی باید مسئول و مهلت داشته باشد. شمارهٔ مصوبات هنگام تأیید نهایی صادر می‌شود.">
        <div className="space-y-4">
          {resolutions.map((r) => (
            <div key={r.id} className="rounded-lg border border-paper-line p-3">
              <ResolutionFields meetingId={m.id} r={r} agenda={agenda} owners={selectable(r.owner_member_id)} />
            </div>
          ))}
          <div key={`new-resolution-${resolutions.length}`} className="rounded-lg border border-dashed border-paper-line p-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">افزودن مصوبهٔ جدید</p>
            <ResolutionFields meetingId={m.id} agenda={agenda} owners={selectable(null)} defaultPosition={nextResPos} />
          </div>
        </div>
      </EditorSection>

      {/* 5. approval */}
      <EditorSection n={5} title="تأیید نهایی صورت‌جلسه" hint="پس از تأیید، شمارهٔ جلسه و مصوبات صادر، صورت‌جلسه قفل و PDF با کد استعلام اصالت ساخته می‌شود. امضای اعضا روی نسخهٔ چاپی است.">
        <ul className="mb-4 space-y-1.5">
          {readiness.items.map((i) => (
            <li key={i.key} className={cn("flex items-center gap-2 text-sm", i.ok ? "text-ink" : "text-status-cancelled")}>
              {i.ok ? <CheckCircle2 className="h-4 w-4 text-status-final" /> : <Circle className="h-4 w-4" />}
              {i.label}
            </li>
          ))}
        </ul>
        <p className="mb-4 text-xs text-ink-muted">
          حد نصاب (اطلاعی، اجباری نیست): {toFaDigits(readiness.quorum.present)} نفر حاضر از {toFaDigits(rollCall.filter((x) => x.is_active).length)} عضو فعال — حداقل اکثریت: {toFaDigits(readiness.quorum.needed)} نفر
          {readiness.quorum.met ? " ✓" : " — هنوز برقرار نیست"}
        </p>
        {!access.approve ? (
          <p className="text-sm text-ink-muted">تأیید نهایی فقط با دسترسی «تأیید صورت‌جلسه» ممکن است.</p>
        ) : (
          <BoardForm action={approveBoardMeeting} submitLabel="تأیید نهایی و قفل صورت‌جلسه" variant="seal" confirmText="پس از تأیید، صورت‌جلسه دیگر قابل ویرایش نیست. ادامه می‌دهید؟">
            <input type="hidden" name="meeting_id" value={m.id} />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="create_next" defaultChecked className="h-4 w-4" /> جلسهٔ بعد به‌صورت پیش‌نویس ساخته شود
            </label>
            <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
              <Field label="تاریخ جلسهٔ بعد" hint="پیشنهاد: ۱۴ روز بعد"><JalaliDateInput name="next_date" defaultISO={tehranDate(nextSuggestion)} /></Field>
              <Field label="ساعت"><input name="next_time" defaultValue={time} dir="ltr" className="input text-center tnum" /></Field>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" name="confirm" className="h-4 w-4" /> صورت‌جلسه را بازبینی کرده‌ام و تأیید می‌کنم.
            </label>
          </BoardForm>
        )}
      </EditorSection>
    </div>
  );
}

function ResolutionFields({
  meetingId, r, agenda, owners, defaultPosition,
}: {
  meetingId: string; r?: BoardResolution; agenda: BoardAgendaItem[]; owners: BoardMember[]; defaultPosition?: number;
}) {
  return (
    <BoardForm
      action={saveResolution}
      submitLabel={r ? "ذخیرهٔ مصوبه" : "افزودن مصوبه"}
      variant={r ? "ghost" : "primary"}
      resetOnSuccess={!r}
      extra={r && <BoardButton action={deleteResolution} fields={{ meeting_id: meetingId, id: r.id }} label="حذف مصوبه" confirmText="این مصوبه حذف شود؟" className="text-status-cancelled" />}
    >
      <input type="hidden" name="meeting_id" value={meetingId} />
      {r && <input type="hidden" name="id" value={r.id} />}
      <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
        <Field label="ردیف"><input name="position" type="number" min={1} max={500} defaultValue={r?.position ?? defaultPosition ?? 1} className="input text-center tnum" /></Field>
        <Field label="مربوط به بند">
          <select name="agenda_item_id" defaultValue={r?.agenda_item_id ?? ""} className="input"><option value="">—</option>
            {agenda.map((a) => <option key={a.id} value={a.id}>{toFaDigits(a.position)}. {a.title}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-3"><Field label="متن دقیق مصوبه" required><textarea name="text" defaultValue={r?.text ?? ""} required rows={3} className="input" /></Field></div>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="requires_action" defaultChecked={r ? r.requires_action : true} className="h-4 w-4" /> مصوبهٔ اجرایی است (مسئول و مهلت دارد)
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="مسئول اجرا">
          <select name="owner_member_id" defaultValue={r?.owner_member_id ?? ""} className="input"><option value="">—</option>
            {owners.map((x) => <option key={x.id} value={x.id}>{memberLabel(x)}</option>)}
          </select>
        </Field>
        <Field label="مهلت"><JalaliDateInput name="due_date" defaultISO={r?.due_date ?? null} /></Field>
        <Field label="خروجی مورد انتظار"><input name="expected_output" defaultValue={r?.expected_output ?? ""} className="input" /></Field>
      </div>
      <div className="mt-3"><Field label="نتیجهٔ رأی / نظر مخالف (اختیاری)"><input name="vote_note" defaultValue={r?.vote_note ?? ""} className="input" placeholder="مثلاً: با اتفاق آرا تصویب شد." /></Field></div>
    </BoardForm>
  );
}

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { Field } from "@/components/form";
import { toFaDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { BOARD_MEMBER_KIND, BOARD_MEMBER_KIND_LABEL, boardAccess, type BoardMember } from "@/lib/board/types";
import { deleteBoardMember, saveBoardMember, saveBoardSettings } from "@/app/actions/board";
import { BoardButton, BoardForm } from "../BoardForm";
import { TelegramLink } from "./TelegramLink";

export const dynamic = "force-dynamic";

type Opt = { id: string; label: string };

function MemberFields({ m, profiles, defaultSort }: { m?: BoardMember; profiles: Opt[]; defaultSort?: number }) {
  return (
    <>
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="نام و نام خانوادگی" required><input name="full_name" defaultValue={m?.full_name ?? ""} required className="input" /></Field>
        <Field label="سمت در هیئت‌مدیره"><input name="position_title" defaultValue={m?.position_title ?? ""} className="input" placeholder="رئیس هیئت‌مدیره، عضو، ..." /></Field>
        <Field label="نوع عضویت" required>
          <select name="kind" defaultValue={m?.kind ?? "INTERNAL"} className="input">
            {BOARD_MEMBER_KIND.map((k) => <option key={k} value={k}>{BOARD_MEMBER_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_6rem_1fr]">
        <Field label="کاربر نیل آفیس (فقط عضو داخلی)" hint="برای پیگیری مصوبات در فاز بعد؛ عضو بیرونی حساب کاربری ندارد.">
          <select name="profile_id" defaultValue={m?.profile_id ?? ""} className="input"><option value="">—</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="ترتیب"><input name="sort_order" type="number" min={0} max={1000} defaultValue={m?.sort_order ?? defaultSort ?? 0} className="input text-center tnum" /></Field>
        <Field label="یادداشت"><input name="notes" defaultValue={m?.notes ?? ""} className="input" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="is_active" defaultChecked={m ? m.is_active : true} className="h-4 w-4" /> عضو فعال است
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="is_notice_recipient" defaultChecked={m?.is_notice_recipient ?? false} className="h-4 w-4" />
          گیرندهٔ اعلان‌های دبیرخانه (گزارش‌های منتظر بررسی و خلاصهٔ روزانه)
        </label>
      </div>
    </>
  );
}

export default async function BoardMembersPage() {
  const profile = await requireProfile();
  const access = boardAccess(profile);
  const supabase = await createClient();
  const [{ data: membersData }, { data: profilesData }, { data: settings }, { data: linksData }] = await Promise.all([
    supabase.from("board_members").select("*").order("sort_order").order("full_name"),
    supabase.from("profiles").select("id, full_name, title").eq("is_active", true).order("full_name"),
    supabase.from("board_settings").select("last_manual_meeting_number, default_location").eq("id", 1).maybeSingle(),
    supabase.from("board_telegram_links").select("member_id, linked_at"),
  ]);
  const linkedAt = new Map(((linksData ?? []) as { member_id: string; linked_at: string }[]).map((l) => [l.member_id, l.linked_at]));
  const members = (membersData ?? []) as BoardMember[];
  const profiles: Opt[] = (profilesData ?? []).map((p) => ({ id: p.id as string, label: `${p.full_name ?? "—"}${p.title ? ` — ${p.title}` : ""}` }));

  return (
    <div>
      <PageHeader title="اعضای هیئت‌مدیره" subtitle="اعضای داخلی و بیرونی؛ عضوی که در جلسه‌ای ثبت شده حذف نمی‌شود، غیرفعال می‌شود." />

      <Card className="mb-5">
        {members.length === 0 ? <p className="text-sm text-ink-muted">هنوز عضوی ثبت نشده است.</p> : (
          <ul className="divide-y divide-paper-line">
            {members.map((m) => (
              <li key={m.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-ink">{m.full_name}</span>
                    {m.position_title && <span className="text-ink-muted">— {m.position_title}</span>}
                    <span className={cn("badge bg-paper", m.kind === "EXTERNAL" ? "status-waiting" : "status-sent")}>{BOARD_MEMBER_KIND_LABEL[m.kind]}</span>
                    {!m.is_active && <span className="badge bg-paper status-cancelled">غیرفعال</span>}
                    {m.is_notice_recipient && <span className="badge bg-paper status-final">گیرندهٔ اعلان‌ها</span>}
                    {linkedAt.has(m.id) && <span className="badge bg-paper status-sent">تلگرام</span>}
                  </summary>
                  <TelegramLink memberId={m.id} linkedAt={linkedAt.get(m.id) ?? null} canManage={access.create} isActive={m.is_active} />
                  {access.create && (
                    <div className="mt-3">
                      <BoardForm
                        action={saveBoardMember}
                        submitLabel="ذخیره"
                        variant="ghost"
                        extra={access.admin && <BoardButton action={deleteBoardMember} fields={{ id: m.id }} label="حذف عضو" confirmText="این عضو حذف شود؟" className="text-status-cancelled" />}
                      >
                        <MemberFields m={m} profiles={profiles} />
                      </BoardForm>
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {access.create && (
        <Card className="mb-5">
          <p className="mb-3 text-sm font-medium text-ink">افزودن عضو</p>
          <div key={`new-member-${members.length}`}>
            <BoardForm action={saveBoardMember} submitLabel="افزودن عضو" resetOnSuccess>
              <MemberFields profiles={profiles} defaultSort={(members.at(-1)?.sort_order ?? 0) + 1} />
            </BoardForm>
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-1 text-sm font-medium text-ink">تنظیمات دبیرخانه</p>
        <p className="mb-4 text-xs text-ink-muted">
          شمارهٔ جلسات پیوسته است و هنگام تأیید نهایی صادر می‌شود. اگر پیش از این سامانه صورت‌جلسهٔ کاغذی داشته‌اید، شمارهٔ آخرین جلسهٔ کاغذی را وارد کنید تا سری از همان‌جا ادامه یابد.
        </p>
        {access.admin ? (
          <BoardForm action={saveBoardSettings} submitLabel="ذخیرهٔ تنظیمات">
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <Field label="شمارهٔ آخرین جلسهٔ پیش از سامانه"><input name="last_manual_meeting_number" type="number" min={0} max={99999} defaultValue={settings?.last_manual_meeting_number ?? 0} className="input text-center tnum" /></Field>
              <Field label="محل پیش‌فرض جلسات"><input name="default_location" defaultValue={settings?.default_location ?? ""} className="input" /></Field>
            </div>
          </BoardForm>
        ) : (
          <p className="text-sm text-ink">آخرین شمارهٔ کاغذی: {toFaDigits(settings?.last_manual_meeting_number ?? 0)} — تغییر فقط با دسترسی «مدیر دبیرخانه».</p>
        )}
      </Card>
    </div>
  );
}

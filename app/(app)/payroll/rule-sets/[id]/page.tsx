import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, Card } from "@/components/ui";
import { LEGAL_RULE_SET_STATUS_LABEL, LEGAL_RULE_SET_STATUS_TONE } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { LegalRuleSet, LegalRuleEntry } from "@/lib/types/database";
import { NoRuleBanner } from "../../NoRuleBanner";
import { RuleEntryEditor } from "./RuleEntryEditor";
import { RuleSetHeaderForm } from "./RuleSetHeaderForm";
import { RuleSetStatusActions, type RuleTransition } from "./RuleSetStatusActions";

export const dynamic = "force-dynamic";

export default async function RuleSetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const px = payrollAccess(profile);

  const { data: set } = await supabase.from("legal_rule_sets").select("*").eq("id", id).single();
  if (!set) notFound();
  const s = set as LegalRuleSet;

  const [{ data: entries }, { data: transitions }, { data: profiles }] = await Promise.all([
    supabase.from("legal_rule_entries").select("*").eq("rule_set_id", id).order("rule_key"),
    supabase.from("legal_rule_set_transitions").select("to_status, required_tier").eq("from_status", s.status),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]));
  const who = (uid: string | null) => (uid ? (nameOf.get(uid) ?? "—") : "—");
  const trans = ((transitions ?? []) as { to_status: RuleTransition["to"]; required_tier: RuleTransition["tier"] }[]).map((t) => ({
    to: t.to_status, tier: t.required_tier,
  }));
  const isDraft = s.status === "DRAFT";
  const distinctPeople = new Set([s.created_by, s.reviewed_by, s.approved_by].filter(Boolean));
  const sameActor = s.approved_by != null && (s.approved_by === s.created_by || s.approved_by === s.reviewed_by);

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.name}
        subtitle={`${s.jurisdiction} — نسخه ${toFaDigits(String(s.version_number))}`}
        action={<span className={`badge ${LEGAL_RULE_SET_STATUS_TONE[s.status]}`}>{LEGAL_RULE_SET_STATUS_LABEL[s.status]}</span>}
      />
      <NoRuleBanner />

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">مشخصات</p>
        <div className="space-y-1.5 text-sm">
          <p><span className="text-ink-muted">بازهٔ اعتبار: </span><span className="tnum">{formatJalali(s.effective_from)} — {s.effective_to ? formatJalali(s.effective_to) : "باز"}</span></p>
          <p><span className="text-ink-muted">منبع / مرجع: </span>{s.source_reference ?? "—"}</p>
          {s.status_note && <p><span className="text-ink-muted">یادداشت وضعیت: </span>{s.status_note}</p>}
        </div>
        {isDraft && px.create && (
          <div className="mt-3">
            <RuleSetHeaderForm id={s.id} effectiveFrom={s.effective_from} effectiveTo={s.effective_to} sourceReference={s.source_reference} />
          </div>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">سابقهٔ تأیید</p>
        <div className="space-y-1.5 text-sm">
          <p><span className="text-ink-muted">ایجاد: </span>{who(s.created_by)} <span className="tnum text-xs text-ink-muted">{formatJalali(s.created_at)}</span></p>
          <p><span className="text-ink-muted">بررسی: </span>{who(s.reviewed_by)} {s.reviewed_at && <span className="tnum text-xs text-ink-muted">{formatJalali(s.reviewed_at)}</span>}</p>
          <p><span className="text-ink-muted">تأیید: </span>{who(s.approved_by)} {s.approved_at && <span className="tnum text-xs text-ink-muted">{formatJalali(s.approved_at)}</span>}</p>
          {s.retired_by && <p><span className="text-ink-muted">بازنشسته‌سازی: </span>{who(s.retired_by)} {s.retired_at && <span className="tnum text-xs text-ink-muted">{formatJalali(s.retired_at)}</span>}</p>}
        </div>
        {sameActor && distinctPeople.size < 3 && (
          <p className="mt-3 inline-block rounded-md bg-paper px-2 py-1 text-xs text-status-waiting">ایجادکننده و تأییدکننده یکسان‌اند (ثبت شده؛ مسدود نشده است).</p>
        )}
        <div className="mt-4 border-t border-paper-line pt-3">
          {s.status === "RETIRED" ? (
            <p className="text-xs text-ink-muted">این مجموعه بازنشسته شده و دیگر تغییر نمی‌کند.</p>
          ) : (
            <RuleSetStatusActions id={s.id} transitions={trans} canApprove={px.approve} canAdmin={px.admin} />
          )}
        </div>
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">قواعد</p>
        <RuleEntryEditor ruleSetId={s.id} entries={(entries ?? []) as LegalRuleEntry[]} editable={isDraft && px.create} />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader, EmptyState } from "@/components/ui";
import { LEGAL_RULE_SET_STATUS_LABEL, LEGAL_RULE_SET_STATUS_TONE } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { LegalRuleSet } from "@/lib/types/database";
import { NoRuleBanner } from "../NoRuleBanner";

export const dynamic = "force-dynamic";

export default async function RuleSetsPage() {
  const supabase = await createClient();
  const profile = await requireProfile();
  const canCreate = payrollAccess(profile).create;
  const [{ data }, { data: profiles }] = await Promise.all([
    supabase.from("legal_rule_sets").select("*").order("jurisdiction").order("name").order("version_number", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const rows = (data ?? []) as LegalRuleSet[];
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]));

  return (
    <div>
      <PageHeader
        title="قواعد قانونی"
        subtitle="مجموعه‌های نسخه‌دار؛ فقط مجموعهٔ «تأییدشده» در محاسبهٔ نهایی قابل استفاده خواهد بود"
        action={canCreate ? <Link href="/payroll/rule-sets/new" className="btn-seal"><Plus className="h-4 w-4" /> مجموعهٔ جدید</Link> : undefined}
      />
      <NoRuleBanner />
      {rows.length === 0 ? (
        <EmptyState
          title="هنوز مجموعه قانونی تعریف نشده است."
          hint="هیچ نرخ یا آستانهٔ قانونی از قبل ثبت نشده؛ همهٔ قواعد را با منبع معتبر خودتان وارد و تأیید کنید."
          action={canCreate ? <Link href="/payroll/rule-sets/new" className="btn-primary"><Plus className="h-4 w-4" /> مجموعهٔ جدید</Link> : undefined}
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">نام</th><th className="px-4 py-3">حوزه</th><th className="px-4 py-3">نسخه</th>
                <th className="px-4 py-3">بازهٔ اعتبار</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">تأییدکننده</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="px-4 py-3"><Link href={`/payroll/rule-sets/${r.id}`} className="font-medium text-seal hover:underline">{r.name}</Link></td>
                  <td className="px-4 py-3 text-ink-muted">{r.jurisdiction}</td>
                  <td className="px-4 py-3 tnum text-ink-muted">{toFaDigits(String(r.version_number))}</td>
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(r.effective_from)} — {r.effective_to ? formatJalali(r.effective_to) : "باز"}</td>
                  <td className="px-4 py-3"><span className={`badge ${LEGAL_RULE_SET_STATUS_TONE[r.status]}`}>{LEGAL_RULE_SET_STATUS_LABEL[r.status]}</span></td>
                  <td className="px-4 py-3 text-ink-muted">{r.approved_by ? (nameOf.get(r.approved_by) ?? "—") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

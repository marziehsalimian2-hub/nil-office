import { PageHeader, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { NoRuleBanner } from "../../NoRuleBanner";
import { RuleSetForm } from "./RuleSetForm";

export const dynamic = "force-dynamic";

export default async function NewRuleSetPage() {
  const profile = await requireProfile();
  if (!payrollAccess(profile).create) {
    return <Card><p className="text-sm text-ink">برای ایجاد مجموعه قانون به نقش «ثبت» یا بالاتر نیاز دارید.</p></Card>;
  }
  const supabase = await createClient();
  const { data } = await supabase.from("legal_rule_sets").select("id, name, jurisdiction, version_number").order("name");
  const existing = ((data ?? []) as { id: string; name: string; jurisdiction: string; version_number: number }[]).map((r) => ({
    id: r.id,
    label: `${r.name} — ${r.jurisdiction} (نسخه ${r.version_number})`,
  }));
  return (
    <div>
      <PageHeader title="مجموعه قانون جدید" subtitle="با هر ثبت برای همان نام و حوزه، شمارهٔ نسخه خودکار افزایش می‌یابد" />
      <NoRuleBanner />
      <RuleSetForm existing={existing} />
    </div>
  );
}

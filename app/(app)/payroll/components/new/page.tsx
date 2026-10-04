import { PageHeader } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { Card } from "@/components/ui";
import { NoRuleBanner } from "../../NoRuleBanner";
import { ComponentForm } from "../ComponentForm";

export const dynamic = "force-dynamic";

export default async function NewComponentPage() {
  const profile = await requireProfile();
  if (!payrollAccess(profile).create) {
    return <Card><p className="text-sm text-ink">برای تعریف جزء حقوقی جدید به نقش «ثبت» یا بالاتر نیاز دارید.</p></Card>;
  }
  return (
    <div>
      <PageHeader title="جزء حقوقی جدید" subtitle="هیچ مقدار قانونی (نرخ/آستانه) از قبل پر نمی‌شود" />
      <NoRuleBanner />
      <ComponentForm mode="create" />
    </div>
  );
}

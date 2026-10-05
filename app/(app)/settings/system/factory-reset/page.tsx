import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { PageHeader, Card } from "@/components/ui";
import { currentResetGuard } from "@/lib/system-reset/env";
import { OPERATIONAL_PHRASE } from "@/lib/system-reset/phrases";
import { DEFAULT_BASELINES } from "@/lib/system-reset/schemas";
import type { ResetRunRow } from "@/lib/system-reset/types";
import { FactoryResetPanel } from "./FactoryResetPanel";

export const dynamic = "force-dynamic";

/**
 * Settings → System → Factory Reset. Visible only to an active ADMIN who also holds the dedicated SYSTEM_FACTORY_RESET grant
 * (system_reset_grants). Everyone else gets the same neutral message. The permission is checked here, in every action and again
 * inside the database right before execution.
 */
export default async function FactoryResetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const svc = createServiceClient();
  const { data: allowed, error } = await svc.rpc("system_reset_has_permission", { p_user: user.id });
  if (error || allowed !== true) {
    return (
      <div>
        <PageHeader title="بازنشانی کارخانه" subtitle="Factory Reset" />
        <Card><p className="text-sm text-ink-muted">این بخش فقط برای مدیری که مجوز ویژهٔ بازنشانی دارد در دسترس است.</p></Card>
      </div>
    );
  }

  const { env, guard } = currentResetGuard();
  const { data: runs } = await svc
    .from("system_reset_runs")
    .select("id, plan_id, mode, environment, initiated_by, started_at, completed_at, status, phase, backup_reference, manifest_version, counts_deleted, storage_cleanup, integrity_result, report, error")
    .order("started_at", { ascending: false })
    .limit(20);

  return (
    <div>
      <PageHeader
        title="بازنشانی کارخانه (Clean Start)"
        subtitle="حذف کنترل‌شدهٔ داده‌های عملیاتی و آزمایشی؛ پیکربندی، کاربران و ساختار حسابداری می‌مانند"
        action={<Link href="/settings" className="btn-quiet">بازگشت به تنظیمات</Link>}
      />
      <FactoryResetPanel
        env={env}
        productionBlocked={!guard.allowed}
        phrase={OPERATIONAL_PHRASE}
        defaultBaselines={DEFAULT_BASELINES}
        runs={(runs ?? []) as unknown as ResetRunRow[]}
      />
    </div>
  );
}

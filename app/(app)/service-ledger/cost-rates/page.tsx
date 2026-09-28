import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { CostRateRow } from "./CostRateRow";
import type { InternalCostRate } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/**
 * Confidential (spec §11) — gated to ADMIN-tier service_ledger_role in
 * the UI AND enforced again by RLS (0086_service_ledger_rls.sql) at the
 * DB level, so this page never actually leaks data even if the
 * client-side check were somehow bypassed.
 */
export default async function CostRatesPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === "ADMIN" || profile.service_ledger_role === "ADMIN";
  if (!isAdmin) notFound();

  const supabase = await createClient();
  const [{ data: profiles }, { data: rates }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("internal_cost_rates").select("*"),
  ]);

  const rateByProfile = new Map(((rates ?? []) as InternalCostRate[]).map((r) => [r.profile_id, r]));

  return (
    <div>
      <PageHeader title="نرخ تمام‌شدهٔ داخلی" subtitle="محرمانه — فقط برای مدیر خدمات مشتری قابل مشاهده و ویرایش است" />
      <Card>
        <p className="mb-3 text-xs text-ink-muted">
          این نرخ فقط برای محاسبهٔ سودآوری داخلی استفاده می‌شود و هرگز در گزارش‌های مشتری یا فاکتور نشان داده نمی‌شود.
        </p>
        <div className="overflow-hidden rounded-lg border border-paper-line">
          <table className="w-full">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">کارشناس</th>
                <th className="px-4 py-3">نرخ ساعتی</th>
              </tr>
            </thead>
            <tbody>
              {((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => {
                const rate = rateByProfile.get(p.id);
                return (
                  <CostRateRow
                    key={p.id}
                    profileId={p.id}
                    label={p.full_name ?? "—"}
                    currentRate={rate?.hourly_cost_rate ?? null}
                    currentCurrency={rate?.currency ?? "IRR"}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { Plus, Kanban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { OpportunityStageBadge } from "@/components/OpportunityStageBadge";
import { CRM_OPPORTUNITY_TYPE_LABEL, type CrmOpportunityType } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  opportunity_number: string;
  title: string;
  opportunity_type: string;
  estimated_value: number | null;
  currency_code: string;
  won_at: string | null;
  lost_at: string | null;
  companies: { legal_name: string } | { legal_name: string }[] | null;
  crm_pipeline_stages: { name: string; is_won: boolean; is_lost: boolean } | { name: string; is_won: boolean; is_lost: boolean }[] | null;
};

export default async function OpportunitiesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_opportunities")
    .select("id, opportunity_number, title, opportunity_type, estimated_value, currency_code, won_at, lost_at, companies(legal_name), crm_pipeline_stages(name, is_won, is_lost)")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as Row[];

  return (
    <div>
      <PageHeader
        title="فرصت‌های تجاری"
        subtitle="پایپ‌لاین فرصت‌ها و معاملات در حال پیگیری"
        action={
          <div className="flex gap-2">
            <Link href="/opportunities/board" className="btn-ghost"><Kanban className="h-4 w-4" /> نمای کانبان</Link>
            <Link href="/opportunities/new" className="btn-seal"><Plus className="h-4 w-4" /> فرصت جدید</Link>
          </div>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="هنوز فرصتی ثبت نشده است." hint="برای شروع پایپ‌لاین فروش، اولین فرصت را ثبت کنید."
          action={<Link href="/opportunities/new" className="btn-primary"><Plus className="h-4 w-4" /> فرصت جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">عنوان</th>
              <th className="px-4 py-3">شرکت</th><th className="px-4 py-3">نوع</th>
              <th className="px-4 py-3">مرحله</th><th className="px-4 py-3 text-left">ارزش تخمینی</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => {
                const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
                const stage = Array.isArray(o.crm_pipeline_stages) ? o.crm_pipeline_stages[0] : o.crm_pipeline_stages;
                return (
                  <tr key={o.id} className="table-row">
                    <td className="px-4 py-3 tnum font-medium text-ink"><Link href={`/opportunities/${o.id}`} className="hover:underline">{toFaDigits(o.opportunity_number)}</Link></td>
                    <td className="px-4 py-3 text-ink">{o.title}</td>
                    <td className="px-4 py-3 text-ink-muted">{company?.legal_name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{CRM_OPPORTUNITY_TYPE_LABEL[o.opportunity_type as CrmOpportunityType]}</td>
                    <td className="px-4 py-3">
                      {stage && <OpportunityStageBadge name={stage.name} isWon={stage.is_won} isLost={stage.is_lost} />}
                    </td>
                    <td className="px-4 py-3 text-left tnum text-ink">{o.estimated_value != null ? `${formatMoney(o.estimated_value)} ${o.currency_code}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

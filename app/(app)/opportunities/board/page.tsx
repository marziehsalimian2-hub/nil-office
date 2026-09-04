import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { BoardClient } from "./BoardClient";

export const dynamic = "force-dynamic";

export default async function OpportunityBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline_id?: string }>;
}) {
  const { pipeline_id } = await searchParams;
  const supabase = await createClient();

  const { data: pipelines } = await supabase.from("crm_pipelines").select("id, name").eq("is_active", true).order("sort_order");
  const activePipelineId = pipeline_id || pipelines?.[0]?.id;

  const [{ data: stages }, { data: opportunities }] = await Promise.all([
    activePipelineId
      ? supabase.from("crm_pipeline_stages").select("id, name, sort_order, is_won, is_lost").eq("pipeline_id", activePipelineId).order("sort_order")
      : Promise.resolve({ data: [] }),
    activePipelineId
      ? supabase
          .from("crm_opportunities")
          .select("id, opportunity_number, title, stage_id, estimated_value, currency_code, companies(legal_name), profiles!owner_user_id(full_name)")
          .eq("pipeline_id", activePipelineId)
      : Promise.resolve({ data: [] }),
  ]);

  type OppRow = {
    id: string;
    opportunity_number: string;
    title: string;
    stage_id: string;
    estimated_value: number | null;
    currency_code: string;
    companies: { legal_name: string } | { legal_name: string }[] | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const cards = ((opportunities ?? []) as OppRow[]).map((o) => {
    const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
    const owner = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
    return {
      id: o.id,
      opportunity_number: o.opportunity_number,
      title: o.title,
      stage_id: o.stage_id,
      estimated_value: o.estimated_value,
      currency_code: o.currency_code,
      companyName: company?.legal_name ?? null,
      ownerName: owner?.full_name ?? null,
    };
  });

  return (
    <div>
      <PageHeader
        title="کانبان فرصت‌های تجاری"
        subtitle="فرصت‌ها را بین مراحل جابه‌جا کنید"
        action={
          (pipelines ?? []).length > 1 ? (
            <div className="flex gap-2">
              {(pipelines ?? []).map((p) => (
                <Link
                  key={p.id}
                  href={`/opportunities/board?pipeline_id=${p.id}`}
                  className={p.id === activePipelineId ? "btn-seal" : "btn-ghost"}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />
      <BoardClient stages={(stages ?? []) as { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean }[]} cards={cards} />
    </div>
  );
}

import { PageHeader } from "@/components/ui";
import { loadFormOptions } from "@/app/actions/options";
import { FollowupForm } from "./FollowupForm";
export const dynamic = "force-dynamic";
export default async function NewFollowupPage({
  searchParams,
}: {
  searchParams: Promise<{ company_id?: string; opportunity_id?: string }>;
}) {
  const { company_id, opportunity_id } = await searchParams;
  const { cases, profiles } = await loadFormOptions();
  return (
    <div>
      <PageHeader title="پیگیری جدید" subtitle="ثبت یادآور / پیگیری" />
      <FollowupForm
        cases={cases.map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        profiles={profiles.map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
        companyId={company_id}
        opportunityId={opportunity_id}
      />
    </div>
  );
}

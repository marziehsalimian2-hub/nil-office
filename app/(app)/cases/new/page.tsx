import { PageHeader } from "@/components/ui";
import { loadFormOptions } from "@/app/actions/options";
import { CaseForm } from "./CaseForm";
export const dynamic = "force-dynamic";
export default async function NewCasePage() {
  const { companies, profiles } = await loadFormOptions();
  return (
    <div>
      <PageHeader title="پروندهٔ جدید" subtitle="ایجاد پروندهٔ کاری" />
      <CaseForm
        companies={companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        profiles={profiles.map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
    </div>
  );
}

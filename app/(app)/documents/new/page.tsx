import { PageHeader } from "@/components/ui";
import { loadFormOptions } from "@/app/actions/options";
import { DocumentForm } from "./DocumentForm";
export const dynamic = "force-dynamic";
export default async function NewDocumentPage() {
  const { companies, cases } = await loadFormOptions();
  return (
    <div>
      <PageHeader title="سند جدید" subtitle="بایگانی سند (بدون شمارهٔ نامه)" />
      <DocumentForm
        companies={companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={cases.map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
      />
    </div>
  );
}

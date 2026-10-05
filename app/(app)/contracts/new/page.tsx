import { PageHeader } from "@/components/ui";
import { loadContractOptions } from "@/app/actions/contract-options";
import { ContractForm } from "./ContractForm";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  const { types, companies, cases, profiles } = await loadContractOptions();
  return (
    <div>
      <PageHeader title="قرارداد جدید" subtitle="ثبت پیش‌نویس قرارداد" />
      <ContractForm
        types={types.map((t) => ({ id: t.id, label: t.label_fa }))}
        companies={companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={cases.map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        profiles={profiles.map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
    </div>
  );
}

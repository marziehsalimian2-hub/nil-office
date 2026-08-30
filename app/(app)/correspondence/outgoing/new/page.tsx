import { PageHeader } from "@/components/ui";
import { loadFormOptions } from "@/app/actions/options";
import { OutgoingForm } from "./OutgoingForm";

export const dynamic = "force-dynamic";

export default async function NewOutgoingPage() {
  const { companies, cases, profiles } = await loadFormOptions();
  return (
    <div>
      <PageHeader title="نامه صادره جدید" subtitle="ثبت پیش‌نویس نامه خروجی" />
      <OutgoingForm
        companies={companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={cases.map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        profiles={profiles.map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
    </div>
  );
}

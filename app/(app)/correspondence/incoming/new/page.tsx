import { PageHeader } from "@/components/ui";
import { loadFormOptions } from "@/app/actions/options";
import { IncomingForm } from "./IncomingForm";

export const dynamic = "force-dynamic";

export default async function NewIncomingPage() {
  const { companies, cases, profiles } = await loadFormOptions();
  return (
    <div>
      <PageHeader title="ثبت نامه وارده" subtitle="ثبت مکاتبهٔ دریافتی و اخذ شمارهٔ ثبت" />
      <IncomingForm
        companies={companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={cases.map((c) => ({ id: c.id, label: `${c.case_code ?? ""} ${c.title}`.trim() }))}
        profiles={profiles.map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
    </div>
  );
}

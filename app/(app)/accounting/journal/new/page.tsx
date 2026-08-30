import { PageHeader, Card } from "@/components/ui";
import { loadAccountingOptions, getDisplayUnit } from "@/app/actions/accounting-options";
import { JournalForm } from "./JournalForm";
export const dynamic = "force-dynamic";
export default async function NewJournalPage() {
  const opts = await loadAccountingOptions();
  const unit = await getDisplayUnit();
  const openFy = opts.fiscalYears.filter((f) => f.status === "OPEN").map((f) => ({ id: f.id, label: f.title }));
  if (opts.postingAccounts.length === 0 || openFy.length === 0) {
    return (
      <div>
        <PageHeader title="سند حسابداری جدید" />
        <Card><p className="text-sm text-ink">برای ثبت سند ابتدا باید حداقل یک «سال مالی باز» و چند «حساب قابل‌ثبت» داشته باشید.</p></Card>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="سند حسابداری جدید" subtitle="ثبت سند دفتر روزنامه (دو طرفه)" />
      <JournalForm
        accounts={opts.postingAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
        details={opts.details.map((d) => ({ id: d.id, label: d.name }))}
        companies={opts.companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={opts.cases.map((c) => ({ id: c.id, label: `${c.case_code} — ${c.title}` }))}
        fiscalYears={openFy}
        unit={unit}
      />
    </div>
  );
}

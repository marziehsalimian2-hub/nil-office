import { PageHeader, Card } from "@/components/ui";
import { loadAccountingOptions } from "@/app/actions/accounting-options";
import { createReceipt } from "@/app/actions/accounting";
import { CashDocForm } from "@/components/CashDocForm";
export const dynamic = "force-dynamic";
export default async function NewReceiptPage() {
  const o = await loadAccountingOptions();
  const openFy = o.fiscalYears.filter((f) => f.status === "OPEN").map((f) => ({ id: f.id, label: f.title }));
  if (o.banks.length === 0 || openFy.length === 0)
    return (<div><PageHeader title="دریافت جدید" /><Card><p className="text-sm text-ink">ابتدا یک «سال مالی باز» و حداقل یک «حساب بانکی/صندوق» تعریف کنید.</p></Card></div>);
  return (
    <div>
      <PageHeader title="دریافت جدید" subtitle="ثبت وجه دریافتی" />
      <CashDocForm kind="receipt" action={createReceipt}
        banks={o.banks.map((b) => ({ id: b.id, label: b.account_title }))}
        accounts={o.postingAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
        details={o.details.map((d) => ({ id: d.id, label: d.name }))}
        companies={o.companies.map((c) => ({ id: c.id, label: c.legal_name }))}
        cases={o.cases.map((c) => ({ id: c.id, label: `${c.case_code} — ${c.title}` }))}
        contracts={o.contracts.map((c) => ({ id: c.id, label: c.display_number ?? c.external_contract_number ?? c.title }))}
        fiscalYears={openFy} />
    </div>
  );
}

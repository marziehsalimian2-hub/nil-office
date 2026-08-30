import { PageHeader } from "@/components/ui";
import { loadAccountingOptions } from "@/app/actions/accounting-options";
import { AccountForm } from "./AccountForm";
export const dynamic = "force-dynamic";
export default async function NewAccountPage() {
  const { allAccounts } = await loadAccountingOptions();
  const parents = allAccounts.filter((a) => a.level < 4).map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
  return (<div><PageHeader title="حساب جدید" subtitle="افزودن حساب به کدینگ" /><AccountForm parents={parents} /></div>);
}

import { PageHeader } from "@/components/ui";
import { loadAccountingOptions } from "@/app/actions/accounting-options";
import { BankForm } from "./BankForm";
export const dynamic = "force-dynamic";
export default async function NewBankPage() {
  const { postingAccounts } = await loadAccountingOptions();
  const accounts = postingAccounts.filter((a) => a.account_type === "ASSET").map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
  return (<div><PageHeader title="حساب بانکی / صندوق جدید" /><BankForm accounts={accounts} /></div>);
}

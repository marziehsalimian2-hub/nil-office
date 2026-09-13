import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ChequeTemplateForm } from "./ChequeTemplateForm";

export const dynamic = "force-dynamic";

export default async function NewChequeTemplatePage() {
  const supabase = await createClient();
  const { data: bankAccounts } = await supabase.from("bank_accounts").select("id, bank_name, account_title").eq("is_active", true).order("account_title");
  return (
    <div>
      <PageHeader title="قالب چاپ جدید" subtitle="پس از ساخت، مختصات فیلدها را در صفحهٔ تنظیم قالب وارد کنید" />
      <ChequeTemplateForm bankAccounts={(bankAccounts ?? []).map((b) => ({ id: b.id, label: `${b.bank_name ?? ""} — ${b.account_title}` }))} />
    </div>
  );
}

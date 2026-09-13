import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ChequeBookForm } from "./ChequeBookForm";

export const dynamic = "force-dynamic";

export default async function NewChequeBookPage() {
  const supabase = await createClient();
  const { data: bankAccounts } = await supabase.from("bank_accounts").select("id, bank_name, account_title").eq("is_active", true).order("account_title");
  return (
    <div>
      <PageHeader title="دسته‌چک جدید" subtitle="ثبت یک دسته‌چک بانکی" />
      <ChequeBookForm bankAccounts={(bankAccounts ?? []).map((b) => ({ id: b.id, label: `${b.bank_name ?? ""} — ${b.account_title}` }))} />
    </div>
  );
}

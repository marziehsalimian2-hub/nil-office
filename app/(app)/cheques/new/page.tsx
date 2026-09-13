import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ChequeForm } from "./ChequeForm";

export const dynamic = "force-dynamic";

export default async function NewChequePage() {
  const supabase = await createClient();
  const [{ data: books }, { data: companies }, { data: contracts }] = await Promise.all([
    supabase.from("cheque_books").select("id, book_identifier").eq("status", "ACTIVE").order("book_identifier"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("contracts").select("id, title, display_number").order("created_at", { ascending: false }).limit(200),
  ]);

  return (
    <div>
      <PageHeader title="چک جدید" subtitle="ثبت پیش‌نویس چک دریافتی یا پرداختی" />
      <ChequeForm
        books={(books ?? []).map((b) => ({ id: b.id, label: b.book_identifier }))}
        companies={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
        contracts={(contracts ?? []).map((c) => ({ id: c.id, label: c.display_number ?? c.title }))}
      />
    </div>
  );
}

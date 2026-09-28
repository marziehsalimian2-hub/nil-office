import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { NewBillingBatchForm } from "./NewBillingBatchForm";

export const dynamic = "force-dynamic";

type Row = { id: string; default_currency: string; companies: { legal_name: string } | { legal_name: string }[] | null };

export default async function NewBillingBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ client_service_file_id?: string }>;
}) {
  const { client_service_file_id } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_service_files")
    .select("id, default_currency, companies(legal_name)")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false });
  const files = (data ?? []) as unknown as Row[];
  const options = files.map((f) => ({
    id: f.id,
    currency: f.default_currency,
    label: (Array.isArray(f.companies) ? f.companies[0] : f.companies)?.legal_name ?? "—",
  }));

  return (
    <div>
      <PageHeader title="دستهٔ صورتحساب جدید" subtitle="ابتدا مشتری را انتخاب کنید — ردیف‌ها را در مرحلهٔ بعد اضافه می‌کنید" />
      <NewBillingBatchForm options={options} defaultId={client_service_file_id} />
    </div>
  );
}

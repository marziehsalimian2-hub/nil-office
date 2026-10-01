import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { NewPersonnelForm } from "./NewPersonnelForm";

export const dynamic = "force-dynamic";

export default async function NewPersonnelPage() {
  const supabase = await createClient();
  const [{ data: managers }, { data: profiles }] = await Promise.all([
    supabase.from("personnel").select("id, first_name, last_name, job_title").eq("employment_status", "ACTIVE").order("first_name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  return (
    <div>
      <PageHeader title="افزودن پرسنل جدید" subtitle="ایجاد پروندهٔ پرسنلی و رکورد اشتغال اولیه" />
      <NewPersonnelForm
        managers={(managers ?? []).map((m) => ({ id: m.id, label: `${m.first_name} ${m.last_name} — ${m.job_title}` }))}
        profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      />
    </div>
  );
}

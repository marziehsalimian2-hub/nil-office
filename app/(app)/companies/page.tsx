import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { CrmStatusBadge } from "@/components/CrmStatusBadge";
import { FilterBar } from "./FilterBar";
import type { Company } from "@/lib/types/database";
export const dynamic = "force-dynamic";

type SearchParams = { crm_status?: string; role?: string; owner_user_id?: string };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("companies").select("*").order("legal_name");
  if (sp.crm_status) query = query.eq("crm_status", sp.crm_status);
  if (sp.owner_user_id) query = query.eq("owner_user_id", sp.owner_user_id);
  if (sp.role) {
    const { data: roleRows } = await supabase.from("crm_company_roles").select("company_id").eq("role", sp.role);
    const ids = (roleRows ?? []).map((r) => r.company_id);
    query = query.in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data }, { data: profiles }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);
  const rows = (data ?? []) as Company[];

  return (
    <div>
      <PageHeader title="شرکت‌ها" subtitle="دفترچهٔ طرف‌های مکاتبه"
        action={<Link href="/companies/new" className="btn-seal"><Plus className="h-4 w-4" /> شرکت جدید</Link>} />
      <FilterBar profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))} />
      {rows.length === 0 ? (
        <EmptyState title="شرکتی با این فیلترها یافت نشد." hint="فیلترها را تغییر دهید یا شرکت جدیدی ثبت کنید."
          action={<Link href="/companies/new" className="btn-primary"><Plus className="h-4 w-4" /> شرکت جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">نام شرکت</th><th className="px-4 py-3">نام انگلیسی</th>
              <th className="px-4 py-3">کشور</th><th className="px-4 py-3">رابط</th><th className="px-4 py-3">تلفن</th>
              <th className="px-4 py-3">وضعیت</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/companies/${c.id}`} className="hover:underline">{c.legal_name}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted" dir="ltr">{c.english_name || "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.country || "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.contact_person || "—"}</td>
                  <td className="px-4 py-3 text-ink-muted tnum" dir="ltr">{c.phone || "—"}</td>
                  <td className="px-4 py-3"><CrmStatusBadge status={c.crm_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

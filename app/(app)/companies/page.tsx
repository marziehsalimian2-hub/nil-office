import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { CrmStatusBadge } from "@/components/CrmStatusBadge";
import type { Company } from "@/lib/types/database";
export const dynamic = "force-dynamic";
export default async function CompaniesPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("*").order("legal_name");
  const rows = (data ?? []) as Company[];
  return (
    <div>
      <PageHeader title="شرکت‌ها" subtitle="دفترچهٔ طرف‌های مکاتبه"
        action={<Link href="/companies/new" className="btn-seal"><Plus className="h-4 w-4" /> شرکت جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="هنوز شرکتی ثبت نشده است." hint="برای افزودن اولین شرکت روی «شرکت جدید» بزنید."
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

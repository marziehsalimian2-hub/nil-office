import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import type { ServiceCategory } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ServiceCategoriesPage() {
  const profile = await requireProfile();
  const isServiceLedgerAdmin = profile.role === "ADMIN" || profile.service_ledger_role === "ADMIN";

  const supabase = await createClient();
  const { data } = await supabase.from("service_categories").select("*").order("name");
  const rows = (data ?? []) as ServiceCategory[];

  return (
    <div>
      <PageHeader
        title="دسته‌بندی خدمات"
        subtitle="فهرست قابل‌گسترش دسته‌بندی خدمات مشتری"
        action={
          isServiceLedgerAdmin ? (
            <Link href="/service-ledger/categories/new" className="btn-seal">
              <Plus className="h-4 w-4" /> دستهٔ جدید
            </Link>
          ) : undefined
        }
      />
      {!isServiceLedgerAdmin && (
        <Card className="mb-4">
          <p className="text-sm text-ink-muted">افزودن یا ویرایش دسته‌بندی خدمات فقط برای مدیر خدمات مشتری ممکن است.</p>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState title="دسته‌ای تعریف نشده است." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">کد</th>
                <th className="px-4 py-3">نام</th>
                <th className="px-4 py-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3 tnum text-ink-muted" dir="ltr">
                    {c.code}
                  </td>
                  <td className="px-4 py-3 text-ink">{c.name}</td>
                  <td className="px-4 py-3">
                    {c.is_active ? <span className="text-status-final">فعال</span> : <span className="text-ink-muted">غیرفعال</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

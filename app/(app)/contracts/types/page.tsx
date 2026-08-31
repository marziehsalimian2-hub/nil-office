import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import type { ContractType } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ContractTypesPage() {
  const profile = await requireProfile();
  const isContractAdmin = profile.role === "ADMIN" || profile.contract_role === "ADMIN";

  const supabase = await createClient();
  const { data } = await supabase.from("contract_types").select("*").order("name");
  const rows = (data ?? []) as ContractType[];

  return (
    <div>
      <PageHeader
        title="انواع قرارداد"
        subtitle="فهرست قابل‌گسترش دسته‌بندی قراردادها"
        action={
          isContractAdmin ? (
            <Link href="/contracts/types/new" className="btn-seal">
              <Plus className="h-4 w-4" /> نوع جدید
            </Link>
          ) : undefined
        }
      />
      {!isContractAdmin && (
        <Card className="mb-4">
          <p className="text-sm text-ink-muted">افزودن یا ویرایش انواع قرارداد فقط برای مدیر قراردادها ممکن است.</p>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState title="نوعی تعریف نشده است." />
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
              {rows.map((t) => (
                <tr key={t.id} className="table-row">
                  <td className="px-4 py-3 tnum text-ink-muted" dir="ltr">
                    {t.code}
                  </td>
                  <td className="px-4 py-3 text-ink">{t.name}</td>
                  <td className="px-4 py-3">
                    {t.is_active ? <span className="text-status-final">فعال</span> : <span className="text-ink-muted">غیرفعال</span>}
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

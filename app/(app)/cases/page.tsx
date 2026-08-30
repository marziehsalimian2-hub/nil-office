import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { CASE_STATUS_LABEL, type CaseStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { Case } from "@/lib/types/database";
export const dynamic = "force-dynamic";
const TONE: Record<CaseStatus, string> = {
  ACTIVE: "text-status-final", WAITING: "text-status-waiting",
  CLOSED: "text-status-closed", CANCELLED: "text-status-cancelled",
};
export default async function CasesPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("cases").select("*").order("created_at", { ascending: false });
  const rows = (data ?? []) as Case[];
  return (
    <div>
      <PageHeader title="پرونده‌ها" subtitle="پرونده‌های کاری شرکت"
        action={<Link href="/cases/new" className="btn-seal"><Plus className="h-4 w-4" /> پروندهٔ جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="هنوز پرونده‌ای ثبت نشده است."
          action={<Link href="/cases/new" className="btn-primary"><Plus className="h-4 w-4" /> پروندهٔ جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">کد</th><th className="px-4 py-3">عنوان</th>
              <th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">تاریخ ایجاد</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3 tnum font-medium">
                    <Link href={`/cases/${c.id}`} className="text-ink hover:text-seal">{toFaDigits(c.case_code ?? "—")}</Link>
                  </td>
                  <td className="px-4 py-3"><Link href={`/cases/${c.id}`} className="text-ink hover:text-seal">{c.title}</Link></td>
                  <td className={`px-4 py-3 text-sm font-medium ${TONE[c.status as CaseStatus]}`}>{CASE_STATUS_LABEL[c.status as CaseStatus]}</td>
                  <td className="px-4 py-3 text-ink-muted tnum">{formatJalali(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

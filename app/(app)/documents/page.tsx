import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { DOCUMENT_TYPE_LABEL, type DocumentType } from "@/lib/enums";
import { formatJalali } from "@/lib/jalali";
import type { DocumentRow } from "@/lib/types/database";
export const dynamic = "force-dynamic";
export default async function DocumentsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
  const rows = (data ?? []) as DocumentRow[];
  return (
    <div>
      <PageHeader title="اسناد" subtitle="بایگانی اسناد غیرمکاتبه‌ای"
        action={<Link href="/documents/new" className="btn-seal"><Plus className="h-4 w-4" /> سند جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="هنوز سندی ثبت نشده است."
          action={<Link href="/documents/new" className="btn-primary"><Plus className="h-4 w-4" /> سند جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="table-head">
              <th className="px-4 py-3">عنوان</th><th className="px-4 py-3">نوع</th>
              <th className="px-4 py-3">نسخه</th><th className="px-4 py-3">تاریخ سند</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="table-row">
                  <td className="px-4 py-3"><Link href={`/documents/${d.id}`} className="font-medium text-ink hover:text-seal">{d.title}</Link></td>
                  <td className="px-4 py-3 text-ink-muted">{DOCUMENT_TYPE_LABEL[d.document_type as DocumentType]}</td>
                  <td className="px-4 py-3 text-ink-muted" dir="ltr">{d.version || "—"}</td>
                  <td className="px-4 py-3 text-ink-muted tnum">{formatJalali(d.document_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

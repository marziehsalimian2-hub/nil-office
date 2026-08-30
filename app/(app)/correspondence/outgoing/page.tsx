import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, StatusBadge } from "@/components/ui";
import { PRIORITY_LABEL, type CorrStatus, type Priority } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { Correspondence, Company } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function OutgoingListPage() {
  const supabase = await createClient();
  const [{ data: rows }, { data: companies }] = await Promise.all([
    supabase
      .from("correspondence")
      .select("*")
      .eq("direction", "OUTGOING")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("companies").select("id, legal_name"),
  ]);

  const letters = (rows ?? []) as Correspondence[];
  const nameOf = new Map(
    ((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]),
  );

  return (
    <div>
      <PageHeader
        title="نامه‌های صادره"
        subtitle="مکاتبات خروجی شرکت"
        action={
          <Link href="/correspondence/outgoing/new" className="btn-seal">
            <Plus className="h-4 w-4" /> نامه صادره جدید
          </Link>
        }
      />

      {letters.length === 0 ? (
        <EmptyState
          title="هنوز نامه صادره‌ای ثبت نشده است."
          hint="برای ثبت اولین نامه صادره، روی «نامه صادره جدید» بزنید."
          action={
            <Link href="/correspondence/outgoing/new" className="btn-primary">
              <Plus className="h-4 w-4" /> نامه صادره جدید
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شماره</th>
                <th className="px-4 py-3">موضوع</th>
                <th className="px-4 py-3">گیرنده</th>
                <th className="px-4 py-3">اولویت</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3">تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((l) => (
                <tr key={l.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/correspondence/${l.id}`} className="tnum font-medium text-ink hover:text-seal">
                      {l.display_number ? toFaDigits(l.display_number) : "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    <Link href={`/correspondence/${l.id}`} className="hover:text-seal">
                      {l.subject || "(بدون موضوع)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {(l.recipient_company_id && nameOf.get(l.recipient_company_id)) || l.recipient_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{PRIORITY_LABEL[l.priority as Priority]}</td>
                  <td className="px-4 py-3"><StatusBadge status={l.status as CorrStatus} /></td>
                  <td className="px-4 py-3 text-ink-muted tnum">{formatJalali(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

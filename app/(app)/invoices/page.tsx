import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { SalesDocumentStatusBadge } from "@/components/SalesDocumentStatusBadge";
import { SALES_DOCUMENT_TYPE_LABEL, type SalesDocumentType } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { SalesDocument, Company } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "", label: "همه" },
  { key: "proforma", label: "پیش‌فاکتورها" },
  { key: "invoice", label: "فاکتورها" },
  { key: "draft", label: "پیش‌نویس‌ها" },
  { key: "unpaid", label: "پرداخت‌نشده" },
  { key: "settled", label: "تسویه‌شده" },
  { key: "cancelled", label: "ابطال‌شده" },
] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("sales_documents").select("*").order("created_at", { ascending: false }).limit(200);
  switch (tab) {
    case "proforma":
      query = query.eq("type", "PROFORMA");
      break;
    case "invoice":
      query = query.eq("type", "INVOICE");
      break;
    case "draft":
      query = query.eq("status", "DRAFT");
      break;
    case "unpaid":
      query = query.eq("type", "INVOICE").in("status", ["ISSUED", "PARTIALLY_SETTLED", "OVERDUE"]);
      break;
    case "settled":
      query = query.eq("status", "SETTLED");
      break;
    case "cancelled":
      query = query.eq("status", "CANCELLED");
      break;
    default:
      break;
  }

  const [{ data }, { data: companies }] = await Promise.all([
    query,
    supabase.from("companies").select("id, legal_name").order("legal_name"),
  ]);

  const rows = (data ?? []) as SalesDocument[];
  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]));

  return (
    <div>
      <PageHeader
        title="فاکتورها"
        subtitle="مدیریت پیش‌فاکتور و فاکتور"
        action={
          <div className="flex gap-2">
            <Link href="/invoices/new?type=PROFORMA" className="btn-ghost">
              <Plus className="h-4 w-4" /> پیش‌فاکتور جدید
            </Link>
            <Link href="/invoices/new?type=INVOICE" className="btn-seal">
              <Plus className="h-4 w-4" /> فاکتور جدید
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key ? `/invoices?tab=${t.key}` : "/invoices"}
            className={cn("btn-ghost", (tab ?? "") === t.key && "border-seal text-seal")}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="سندی ثبت نشده است."
          action={
            <Link href="/invoices/new" className="btn-primary">
              <Plus className="h-4 w-4" /> سند جدید
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شماره</th>
                <th className="px-4 py-3">نوع</th>
                <th className="px-4 py-3">مشتری</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3 text-left">مبلغ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => (
                <tr key={doc.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${doc.id}`} className="tnum font-medium text-seal hover:underline" dir="ltr">
                      {doc.display_number ? toFaDigits(doc.display_number) : "پیش‌نویس"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{SALES_DOCUMENT_TYPE_LABEL[doc.type as SalesDocumentType]}</td>
                  <td className="px-4 py-3 text-ink">
                    {doc.company_id ? (companyName.get(doc.company_id) ?? doc.customer_legal_name_snapshot) : doc.customer_legal_name_snapshot}
                  </td>
                  <td className="px-4 py-3">
                    <SalesDocumentStatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-left tnum">{formatMoney(doc.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

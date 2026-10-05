import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { PageHeader, EmptyState } from "@/components/ui";
import { CONTRACT_STATUS, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, type ContractStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Contract, Company, ContractType } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ContractsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = (CONTRACT_STATUS as readonly string[]).includes(status ?? "") ? (status as ContractStatus) : undefined;

  const supabase = await createClient();
  const unit = await getDisplayUnit();
  let query = supabase.from("contracts").select("*").order("created_at", { ascending: false }).limit(100);
  if (activeStatus) query = query.eq("status", activeStatus);
  const [{ data: rows }, { data: companies }, { data: types }] = await Promise.all([
    query,
    supabase.from("companies").select("id, legal_name"),
    supabase.from("contract_types").select("id, label_fa"),
  ]);

  const contracts = (rows ?? []) as Contract[];
  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]));
  const typeLabel = new Map(((types ?? []) as Pick<ContractType, "id" | "label_fa">[]).map((t) => [t.id, t.label_fa]));

  return (
    <div>
      <PageHeader
        title="قراردادها"
        subtitle="مدیریت چرخهٔ عمر قراردادها"
        action={
          <Link href="/contracts/new" className="btn-seal">
            <Plus className="h-4 w-4" /> قرارداد جدید
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/contracts" className={cn("btn-quiet !py-1.5 text-xs", !activeStatus && "bg-paper text-ink")}>
          همه
        </Link>
        {CONTRACT_STATUS.map((s) => (
          <Link
            key={s}
            href={`/contracts?status=${s}`}
            className={cn("btn-quiet !py-1.5 text-xs", activeStatus === s && "bg-paper text-ink")}
          >
            {CONTRACT_STATUS_LABEL[s]}
          </Link>
        ))}
      </div>

      {contracts.length === 0 ? (
        <EmptyState
          title="هنوز قراردادی ثبت نشده است."
          hint="برای ثبت اولین قرارداد، روی «قرارداد جدید» بزنید."
          action={
            <Link href="/contracts/new" className="btn-primary">
              <Plus className="h-4 w-4" /> قرارداد جدید
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شماره</th>
                <th className="px-4 py-3">عنوان</th>
                <th className="px-4 py-3">طرف قرارداد</th>
                <th className="px-4 py-3">نوع</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3 text-left">مبلغ کل</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/contracts/${c.id}`} className="tnum font-medium text-ink hover:text-seal" dir="ltr">
                      {c.display_number
                        ? toFaDigits(c.display_number)
                        : c.is_historical
                          ? `تاریخی: ${c.original_contract_number ?? "—"}`
                          : "پیش‌نویس"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    <Link href={`/contracts/${c.id}`} className="hover:text-seal">{c.title}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {(c.party_company_id && companyName.get(c.party_company_id)) || c.party_contact_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{typeLabel.get(c.contract_type_id) || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${CONTRACT_STATUS_TONE[c.status]}`}>{CONTRACT_STATUS_LABEL[c.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-left tnum" dir="ltr">{formatMoney(c.total_amount, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

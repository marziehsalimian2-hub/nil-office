import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { ContractStatusBadge } from "@/components/ContractStatusBadge";
import { CONTRACT_STATUS, CONTRACT_STATUS_LABEL } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Contract, ContractType, Company } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const { status, type } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("contracts").select("*").order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("contract_type_id", type);

  const [{ data }, { data: types }, { data: companies }] = await Promise.all([
    query,
    supabase.from("contract_types").select("id, name").order("name"),
    supabase.from("companies").select("id, legal_name"),
  ]);

  const rows = (data ?? []) as Contract[];
  const typeName = new Map(((types ?? []) as Pick<ContractType, "id" | "name">[]).map((t) => [t.id, t.name]));
  const companyName = new Map(
    ((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]),
  );

  return (
    <div>
      <PageHeader
        title="قراردادها"
        subtitle="مدیریت چرخهٔ عمر قراردادها"
        action={
          <div className="flex gap-2">
            <Link href="/contracts/types" className="btn-ghost">
              انواع قرارداد
            </Link>
            <Link href="/contracts/new" className="btn-seal">
              <Plus className="h-4 w-4" /> قرارداد جدید
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/contracts" className={cn("btn-ghost", !status && "border-seal text-seal")}>
          همه
        </Link>
        {CONTRACT_STATUS.map((s) => (
          <Link
            key={s}
            href={`/contracts?status=${s}`}
            className={cn("btn-ghost", status === s && "border-seal text-seal")}
          >
            {CONTRACT_STATUS_LABEL[s]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="قراردادی ثبت نشده است."
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
                <th className="px-4 py-3">نوع</th>
                <th className="px-4 py-3">طرف قرارداد</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3 text-left">مبلغ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/contracts/${c.id}`} className="tnum font-medium text-seal hover:underline" dir="ltr">
                      {c.display_number
                        ? toFaDigits(c.display_number)
                        : c.external_contract_number
                          ? toFaDigits(c.external_contract_number)
                          : "پیش‌نویس"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{c.title}</td>
                  <td className="px-4 py-3 text-ink-muted">{typeName.get(c.contract_type_id) ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {c.counterparty_company_id ? (companyName.get(c.counterparty_company_id) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ContractStatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-left tnum">{formatMoney(c.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

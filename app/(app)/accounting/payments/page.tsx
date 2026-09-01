import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { CashDocRow } from "@/components/CashDocRow";
import { getDisplayUnit, loadAccountingOptions } from "@/app/actions/accounting-options";
import type { Payment } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const opts = await loadAccountingOptions();
  const { data } = await supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(100);
  const rows = (data ?? []) as Payment[];

  const banks = opts.banks.map((b) => ({ id: b.id, label: b.account_title }));
  const accounts = opts.postingAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
  const details = opts.details.map((d) => ({ id: d.id, label: d.name }));
  const companies = opts.companies.map((c) => ({ id: c.id, label: c.legal_name }));
  const cases = opts.cases.map((c) => ({ id: c.id, label: `${c.case_code} — ${c.title}` }));
  const contracts = opts.contracts.map((c) => ({ id: c.id, label: c.display_number ?? c.external_contract_number ?? c.title }));
  const fiscalYears = opts.fiscalYears.map((f) => ({ id: f.id, label: f.title }));

  return (
    <div>
      <PageHeader title="پرداخت‌ها" subtitle="مدیریت اسناد نقدی پرداختی"
        action={<Link href="/accounting/payments/new" className="btn-seal"><Plus className="h-4 w-4" /> پرداخت جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="موردی ثبت نشده است."
          action={<Link href="/accounting/payments/new" className="btn-primary"><Plus className="h-4 w-4" /> پرداخت جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">تاریخ</th><th className="px-4 py-3">پرداخت به</th><th className="px-4 py-3">شرح</th>
              <th className="px-4 py-3 text-left">مبلغ</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <CashDocRow
                  key={r.id}
                  kind="payment"
                  unit={unit}
                  banks={banks}
                  accounts={accounts}
                  details={details}
                  companies={companies}
                  cases={cases}
                  contracts={contracts}
                  fiscalYears={fiscalYears}
                  row={{
                    id: r.id,
                    date: r.payment_date,
                    counterparty: r.payee,
                    amount: r.amount,
                    description: r.description,
                    status: r.status,
                    bank_account_id: r.bank_account_id,
                    counterpart_account_id: r.counterpart_account_id,
                    detail_account_id: r.detail_account_id,
                    method: r.method,
                    reference: r.reference,
                    company_id: r.company_id,
                    case_id: r.case_id,
                    contract_id: r.contract_id,
                    fiscal_year_id: r.fiscal_year_id,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

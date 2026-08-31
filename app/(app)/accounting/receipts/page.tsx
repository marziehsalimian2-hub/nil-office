import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { CashDocRow } from "@/components/CashDocRow";
import { getDisplayUnit, loadAccountingOptions } from "@/app/actions/accounting-options";
import type { Receipt } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const supabase = await createClient();
  const unit = await getDisplayUnit();
  const opts = await loadAccountingOptions();
  const { data } = await supabase.from("receipts").select("*").order("receipt_date", { ascending: false }).limit(100);
  const rows = (data ?? []) as Receipt[];

  const banks = opts.banks.map((b) => ({ id: b.id, label: b.account_title }));
  const accounts = opts.postingAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
  const details = opts.details.map((d) => ({ id: d.id, label: d.name }));
  const companies = opts.companies.map((c) => ({ id: c.id, label: c.legal_name }));
  const cases = opts.cases.map((c) => ({ id: c.id, label: `${c.case_code} — ${c.title}` }));
  const fiscalYears = opts.fiscalYears.map((f) => ({ id: f.id, label: f.title }));

  return (
    <div>
      <PageHeader title="دریافت‌ها" subtitle="مدیریت اسناد نقدی دریافتی"
        action={<Link href="/accounting/receipts/new" className="btn-seal"><Plus className="h-4 w-4" /> دریافت جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="موردی ثبت نشده است."
          action={<Link href="/accounting/receipts/new" className="btn-primary"><Plus className="h-4 w-4" /> دریافت جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">تاریخ</th><th className="px-4 py-3">دریافت‌کننده از</th><th className="px-4 py-3">شرح</th>
              <th className="px-4 py-3 text-left">مبلغ</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <CashDocRow
                  key={r.id}
                  kind="receipt"
                  unit={unit}
                  banks={banks}
                  accounts={accounts}
                  details={details}
                  companies={companies}
                  cases={cases}
                  fiscalYears={fiscalYears}
                  row={{
                    id: r.id,
                    date: r.receipt_date,
                    counterparty: r.payer,
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

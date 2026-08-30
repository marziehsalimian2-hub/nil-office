import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { BANK_KIND_LABEL } from "@/lib/enums";
import { toFaDigits } from "@/lib/jalali";
import type { BankAccount } from "@/lib/types/database";
export const dynamic = "force-dynamic";
export default async function BanksPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("bank_accounts").select("*").order("account_title");
  const rows = (data ?? []) as BankAccount[];
  return (
    <div>
      <PageHeader title="بانک و صندوق" subtitle="حساب‌های نقدی و بانکی"
        action={<Link href="/accounting/banks/new" className="btn-seal"><Plus className="h-4 w-4" /> حساب جدید</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="حساب بانکی/صندوقی ثبت نشده است."
          action={<Link href="/accounting/banks/new" className="btn-primary"><Plus className="h-4 w-4" /> حساب جدید</Link>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((b) => (
            <Card key={b.id}>
              <div className="flex items-center justify-between">
                <p className="font-medium text-ink">{b.account_title}</p>
                <span className="badge bg-paper text-ink-muted">{BANK_KIND_LABEL[b.kind]}</span>
              </div>
              {b.bank_name && <p className="mt-1 text-sm text-ink-muted">{b.bank_name}{b.branch ? ` — ${b.branch}` : ""}</p>}
              {b.iban && <p className="mt-1 text-xs text-ink-muted tnum" dir="ltr">{toFaDigits(b.iban)}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

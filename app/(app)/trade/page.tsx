import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { TradeOfferStatusBadge } from "@/components/TradeOfferStatusBadge";
import { FilterBar } from "./FilterBar";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { TradeOfferStatusT } from "@/lib/types/database";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  offer_code: string;
  title: string;
  product_name: string;
  status: TradeOfferStatusT;
  interest_deadline: string;
  document_deadline: string;
  price: string;
  currency_code: string;
};

type SearchParams = { status?: string; buyer_company_id?: string; q?: string };

export default async function TradeOffersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Opportunistic sweep so the list doesn't show a stale ACTIVE status —
  // never the actual security boundary, just a UX nicety (see the
  // sync_trade_offers_expiry() comment in 0066_trade_portal.sql).
  await supabase.rpc("sync_trade_offers_expiry", { p_id: null });

  let offerIds: string[] | null = null;
  if (sp.buyer_company_id) {
    const { data: assigned } = await supabase
      .from("trade_offer_buyers")
      .select("offer_id")
      .eq("company_id", sp.buyer_company_id);
    offerIds = (assigned ?? []).map((a) => a.offer_id);
  }

  let query = supabase
    .from("trade_offers")
    .select("id, offer_code, title, product_name, status, interest_deadline, document_deadline, price, currency_code")
    .order("created_at", { ascending: false });

  if (sp.status) query = query.eq("status", sp.status);
  if (sp.q) query = query.or(`title.ilike.%${sp.q}%,offer_code.ilike.%${sp.q}%,product_name.ilike.%${sp.q}%`);
  if (offerIds) query = query.in("id", offerIds.length > 0 ? offerIds : ["00000000-0000-0000-0000-000000000000"]);

  const [{ data }, { data: allBuyers }, { data: allResponses }, { data: companies }] = await Promise.all([
    query,
    supabase.from("trade_offer_buyers").select("id, offer_id"),
    supabase.from("trade_offer_responses").select("id, offer_id"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
  ]);

  const rows = (data ?? []) as Row[];
  const buyerCounts = new Map<string, number>();
  for (const b of allBuyers ?? []) buyerCounts.set(b.offer_id, (buyerCounts.get(b.offer_id) ?? 0) + 1);
  const responseCounts = new Map<string, number>();
  for (const r of allResponses ?? []) responseCounts.set(r.offer_id, (responseCounts.get(r.offer_id) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        title="آفرهای تجاری"
        subtitle="مدیریت آفرها، خریداران و پاسخ‌های پورتال معاملات"
        action={<Link href="/trade/new" className="btn-seal"><Plus className="h-4 w-4" /> آفر جدید</Link>}
      />
      <FilterBar buyers={(companies ?? []).map((c) => ({ id: c.id, label: c.legal_name }))} />
      {rows.length === 0 ? (
        <EmptyState title="آفری با این فیلترها یافت نشد." hint="فیلترها را تغییر دهید یا آفر جدیدی ثبت کنید."
          action={<Link href="/trade/new" className="btn-primary"><Plus className="h-4 w-4" /> آفر جدید</Link>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr className="table-head">
                <th className="px-4 py-3">کد آفر</th><th className="px-4 py-3">عنوان</th>
                <th className="px-4 py-3">محصول</th><th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3">مهلت تمایل</th><th className="px-4 py-3">مهلت مدارک</th>
                <th className="px-4 py-3">خریداران</th><th className="px-4 py-3">پاسخ‌ها</th>
                <th className="px-4 py-3 text-left">قیمت</th>
              </tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="table-row">
                    <td className="px-4 py-3 tnum font-medium text-ink">
                      <Link href={`/trade/${o.id}`} className="hover:underline">{toFaDigits(o.offer_code)}</Link>
                    </td>
                    <td className="px-4 py-3 text-ink">{o.title}</td>
                    <td className="px-4 py-3 text-ink-muted">{o.product_name}</td>
                    <td className="px-4 py-3"><TradeOfferStatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-ink-muted">{formatJalali(o.interest_deadline)}</td>
                    <td className="px-4 py-3 text-ink-muted">{formatJalali(o.document_deadline)}</td>
                    <td className="px-4 py-3 tnum text-ink-muted">{toFaDigits(buyerCounts.get(o.id) ?? 0)}</td>
                    <td className="px-4 py-3 tnum text-ink-muted">{toFaDigits(responseCounts.get(o.id) ?? 0)}</td>
                    <td className="px-4 py-3 text-left tnum text-ink">{formatMoney(o.price)} {o.currency_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

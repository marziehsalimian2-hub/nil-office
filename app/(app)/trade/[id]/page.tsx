import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import { TradeOfferStatusBadge } from "@/components/TradeOfferStatusBadge";
import { DetailActions } from "./DetailActions";
import { BuyerPanel } from "./BuyerPanel";
import { DeadlinePanel } from "./DeadlinePanel";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { TRADE_RESPONSE_TYPE_LABEL, TRADE_DOCUMENT_TYPE_LABEL, TRADE_EVENT_TYPE_LABEL, type TradeResponseType, type TradeDocumentType } from "@/lib/enums";
import type { TradeOffer, TradeOfferDeadlineHistory } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function TradeOfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();

  await supabase.rpc("sync_trade_offers_expiry", { p_id: id });

  const { data: offer } = await supabase.from("trade_offers").select("*").eq("id", id).single();
  if (!offer) notFound();
  const o = offer as TradeOffer;

  const canApprove = profile.role === "ADMIN" || profile.trade_role === "APPROVE" || profile.trade_role === "ADMIN";

  const [
    { data: buyers },
    { data: responses },
    { data: documents },
    { data: history },
    { data: events },
    { data: companies },
  ] = await Promise.all([
    supabase.from("trade_offer_buyers").select("*, companies(legal_name)").eq("offer_id", id).order("created_at", { ascending: false }),
    supabase.from("trade_offer_responses").select("*, trade_offer_buyers(company_id, companies(legal_name))").eq("offer_id", id).order("created_at", { ascending: false }),
    supabase.from("trade_offer_documents").select("*, trade_offer_buyers(company_id, companies(legal_name))").eq("offer_id", id).order("uploaded_at", { ascending: false }),
    supabase.from("trade_offer_deadline_history").select("*").eq("offer_id", id).order("changed_at", { ascending: false }),
    supabase.from("trade_offer_events").select("*").eq("offer_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
  ]);

  type BuyerJoined = { id: string; company_id: string; revoked_at: string | null; token_expires_at: string; last_viewed_at: string | null; companies: { legal_name: string } | { legal_name: string }[] | null };
  const buyerRows = (buyers ?? []) as BuyerJoined[];
  const latestResponseByAssignment = new Map<string, { response_type: TradeResponseType; created_at: string }>();
  for (const r of (responses ?? []) as { buyer_assignment_id: string; response_type: TradeResponseType; created_at: string }[]) {
    if (!latestResponseByAssignment.has(r.buyer_assignment_id)) latestResponseByAssignment.set(r.buyer_assignment_id, r);
  }
  const buyerPanelRows = buyerRows.map((b) => {
    const co = Array.isArray(b.companies) ? b.companies[0] : b.companies;
    const latest = latestResponseByAssignment.get(b.id);
    return {
      id: b.id,
      company_id: b.company_id,
      company_name: co?.legal_name ?? "—",
      revoked_at: b.revoked_at,
      token_expires_at: b.token_expires_at,
      last_viewed_at: b.last_viewed_at,
      latest_response_type: latest?.response_type ?? null,
      latest_response_at: latest?.created_at ?? null,
    };
  });

  const signedUrls = new Map<string, string>();
  await Promise.all(
    ((documents ?? []) as { id: string; storage_path: string }[]).map(async (d) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(d.storage_path, 3600);
      if (data?.signedUrl) signedUrls.set(d.id, data.signedUrl);
    }),
  );

  const overviewTab = (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">اطلاعات آفر</p>
        <div className="divide-y divide-paper-line/60 text-sm">
          <div className="flex justify-between py-2"><span className="text-ink-muted">کد آفر</span><span className="tnum text-ink">{toFaDigits(o.offer_code)}</span></div>
          <div className="flex justify-between py-2"><span className="text-ink-muted">محصول</span><span className="text-ink">{o.product_name}{o.product_type ? ` (${o.product_type})` : ""}</span></div>
          <div className="flex justify-between py-2"><span className="text-ink-muted">مقدار</span><span className="tnum text-ink">{toFaDigits(o.quantity)} {o.unit}</span></div>
          <div className="flex justify-between py-2"><span className="text-ink-muted">قیمت واحد</span><span className="tnum text-ink">{formatMoney(o.price)} {o.currency_code}</span></div>
          <div className="flex justify-between py-2"><span className="text-ink-muted">مبنای قیمت</span><span className="text-ink">{o.price_basis}</span></div>
          {o.origin && <div className="flex justify-between py-2"><span className="text-ink-muted">مبدأ</span><span className="text-ink">{o.origin}</span></div>}
          {o.delivery_location && <div className="flex justify-between py-2"><span className="text-ink-muted">محل تحویل</span><span className="text-ink">{o.delivery_location}</span></div>}
          <div className="flex justify-between py-2"><span className="text-ink-muted">مهلت اعلام تمایل</span><span className="text-ink">{formatJalali(o.interest_deadline)}</span></div>
          <div className="flex justify-between py-2"><span className="text-ink-muted">مهلت ارسال LOI/ICPO</span><span className="text-ink">{formatJalali(o.document_deadline)}</span></div>
          <div className="flex justify-between py-2"><span className="text-ink-muted">تاریخ ایجاد</span><span className="text-ink">{formatJalali(o.created_at)}</span></div>
          {o.published_at && <div className="flex justify-between py-2"><span className="text-ink-muted">تاریخ انتشار</span><span className="text-ink">{formatJalali(o.published_at)}</span></div>}
        </div>
      </Card>
      {o.description && <Card><p className="mb-2 text-sm font-medium text-ink">توضیحات</p><p className="whitespace-pre-wrap text-sm text-ink-muted">{o.description}</p></Card>}
      {o.terms_and_conditions && <Card><p className="mb-2 text-sm font-medium text-ink">شرایط و ضوابط</p><p className="whitespace-pre-wrap text-sm text-ink-muted">{o.terms_and_conditions}</p></Card>}
    </div>
  );

  const buyersTab = <BuyerPanel offerId={id} companies={(companies ?? []) as { id: string; legal_name: string }[]} buyers={buyerPanelRows} />;

  const responsesTab = (
    <Card>
      {(responses ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز پاسخی ثبت نشده است.</p>
      ) : (
        <div className="space-y-3">
          {(responses ?? []).map((r) => {
            const buyer = r.trade_offer_buyers as { company_id: string; companies: { legal_name: string } | { legal_name: string }[] | null } | null;
            const co = buyer ? (Array.isArray(buyer.companies) ? buyer.companies[0] : buyer.companies) : null;
            return (
              <div key={r.id} className="border-b border-paper-line pb-3 text-sm last:border-0">
                <p className="text-ink">
                  <span className="font-medium">{co?.legal_name ?? "—"}</span> — {TRADE_RESPONSE_TYPE_LABEL[r.response_type as TradeResponseType]}
                </p>
                {r.explanation && <p className="mt-1 text-ink-muted">{r.explanation}</p>}
                <p className="mt-1 text-xs text-ink-muted">{formatJalali(r.created_at)}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  const documentsTab = (
    <Card>
      {(documents ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز مدرکی بارگذاری نشده است.</p>
      ) : (
        <table className="w-full">
          <thead><tr className="table-head">
            <th className="px-3 py-2">خریدار</th><th className="px-3 py-2">نوع</th>
            <th className="px-3 py-2">فایل</th><th className="px-3 py-2">تاریخ</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {(documents ?? []).map((d) => {
              const buyer = d.trade_offer_buyers as { company_id: string; companies: { legal_name: string } | { legal_name: string }[] | null } | null;
              const co = buyer ? (Array.isArray(buyer.companies) ? buyer.companies[0] : buyer.companies) : null;
              return (
                <tr key={d.id} className="table-row">
                  <td className="px-3 py-2 text-ink">{co?.legal_name ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{TRADE_DOCUMENT_TYPE_LABEL[d.document_type as TradeDocumentType]}</td>
                  <td className="px-3 py-2 text-ink-muted">{d.file_name}</td>
                  <td className="px-3 py-2 text-ink-muted">{formatJalali(d.uploaded_at)}</td>
                  <td className="px-3 py-2">
                    {signedUrls.get(d.id) && <a href={signedUrls.get(d.id)} target="_blank" rel="noopener" className="text-seal hover:underline">دانلود</a>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );

  const deadlinesTab = (
    <DeadlinePanel
      offerId={id}
      canApprove={canApprove}
      currentInterestDeadline={o.interest_deadline}
      currentDocumentDeadline={o.document_deadline}
      history={(history ?? []) as TradeOfferDeadlineHistory[]}
    />
  );

  const historyTab = (
    <Card>
      {(events ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">رویدادی ثبت نشده است.</p>
      ) : (
        <div className="space-y-2">
          {(events ?? []).map((e) => (
            <div key={e.id} className="flex justify-between border-b border-paper-line py-2 text-sm last:border-0">
              <span className="text-ink">{TRADE_EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}</span>
              <span className="text-xs text-ink-muted">{formatJalali(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={o.title}
        subtitle={toFaDigits(o.offer_code)}
        action={<TradeOfferStatusBadge status={o.status} />}
      />
      <div className="mb-6">
        <DetailActions id={id} status={o.status} canApprove={canApprove} />
      </div>
      <Tabs
        tabs={[
          { label: "نمای کلی", content: overviewTab },
          { label: "خریداران", content: buyersTab },
          { label: "پاسخ‌ها", content: responsesTab },
          { label: "مدارک", content: documentsTab },
          { label: "مهلت‌ها", content: deadlinesTab },
          { label: "تاریخچه", content: historyTab },
        ]}
      />
      <div className="mt-4">
        <Link href="/trade" className="text-sm text-ink-muted hover:underline">بازگشت به فهرست آفرها</Link>
      </div>
    </div>
  );
}

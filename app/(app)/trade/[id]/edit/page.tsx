import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TradeOfferForm } from "../../TradeOfferForm";
import type { TradeOffer } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function EditTradeOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: offer } = await supabase.from("trade_offers").select("*").eq("id", id).single();
  if (!offer) notFound();
  const o = offer as TradeOffer;
  if (o.status !== "DRAFT") redirect(`/trade/${id}`);

  return (
    <div>
      <PageHeader title="ویرایش آفر" subtitle={o.offer_code} />
      <TradeOfferForm
        offerId={id}
        initial={{
          title: o.title,
          product_name: o.product_name,
          product_type: o.product_type,
          quantity: o.quantity,
          unit: o.unit,
          price: o.price,
          currency_code: o.currency_code,
          price_basis: o.price_basis,
          origin: o.origin,
          delivery_location: o.delivery_location,
          delivery_terms: o.delivery_terms,
          payment_terms: o.payment_terms,
          description: o.description,
          terms_and_conditions: o.terms_and_conditions,
          interest_deadline: o.interest_deadline,
          document_deadline: o.document_deadline,
          timezone: o.timezone,
        }}
      />
    </div>
  );
}

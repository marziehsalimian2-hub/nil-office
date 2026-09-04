"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { tradeDetailsSchema } from "@/lib/validation-crm";

export type ActionState = { error?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}
const entries = (f: FormData) => Object.fromEntries(f.entries());

/** Create/replace an opportunity's trade details — rejected server-side (TRADE_ONLY) unless the opportunity is TRADE-typed. */
export async function upsertTradeDetails(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = tradeDetailsSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.from("crm_opportunity_trade_details").upsert(
    {
      opportunity_id: d.opportunity_id,
      product_name: d.product_name ?? null,
      grade_specification: d.grade_specification ?? null,
      origin_country: d.origin_country ?? null,
      destination_country: d.destination_country ?? null,
      destination_port: d.destination_port ?? null,
      quantity: d.quantity ?? null,
      unit: d.unit ?? null,
      packaging: d.packaging ?? null,
      incoterm: d.incoterm ?? null,
      delivery_terms: d.delivery_terms ?? null,
      target_price: d.target_price ?? null,
      offered_price: d.offered_price ?? null,
      currency_code: d.currency_code ?? null,
      payment_terms: d.payment_terms ?? null,
      buyer_company_id: d.buyer_company_id ?? null,
      seller_company_id: d.seller_company_id ?? null,
      buyer_contact_id: d.buyer_contact_id ?? null,
      seller_contact_id: d.seller_contact_id ?? null,
      monthly_or_one_time: d.monthly_or_one_time ?? null,
      specification_notes: d.specification_notes ?? null,
    },
    { onConflict: "opportunity_id" },
  );
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${d.opportunity_id}`);
  return null;
}

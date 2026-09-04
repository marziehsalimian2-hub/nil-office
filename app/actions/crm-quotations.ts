"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { quotationSchema } from "@/lib/validation-crm";

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

function quotationPayload(d: ReturnType<typeof quotationSchema.parse>) {
  return {
    direction: d.direction,
    buyer_company_id: d.buyer_company_id ?? null,
    seller_company_id: d.seller_company_id ?? null,
    product_name: d.product_name ?? null,
    quantity: d.quantity ?? null,
    unit: d.unit ?? null,
    unit_price: d.unit_price ?? null,
    currency_code: d.currency_code ?? null,
    incoterm: d.incoterm ?? null,
    origin_country: d.origin_country ?? null,
    destination_country: d.destination_country ?? null,
    validity_date: d.validity_date ?? null,
    payment_terms: d.payment_terms ?? null,
    notes: d.notes ?? null,
  };
}

export async function createQuotation(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = quotationSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.from("crm_quotations").insert({
    opportunity_id: d.opportunity_id,
    ...quotationPayload(d),
    created_by: userId,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${d.opportunity_id}`);
  return null;
}

export async function updateQuotation(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه پیشنهاد نامعتبر است." };
  const parsed = quotationSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.from("crm_quotations").update(quotationPayload(d)).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${d.opportunity_id}`);
  return null;
}

export async function deleteQuotation(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const opportunityId = String(f.get("opportunity_id") ?? "");
  if (!id) return { error: "شناسه پیشنهاد نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("crm_quotations").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (opportunityId) revalidatePath(`/opportunities/${opportunityId}`);
  return null;
}

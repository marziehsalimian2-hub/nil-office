"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  tradeOfferSchema,
  tradeBuyerAssignSchema,
  tradeDeadlineExtensionSchema,
} from "@/lib/validation-trade";
import { generateBuyerToken, hashToken } from "@/lib/trade/token";
import { localDateTimeToIso } from "@/lib/trade/timezone";

export type ActionState = { error?: string } | null;

const entries = (f: FormData) => Object.fromEntries(f.entries());

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

function offerInsertPayload(f: FormData) {
  const parsed = tradeOfferSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message } as const;
  const d = parsed.data;
  const tz = d.timezone;
  return {
    data: {
      title: d.title,
      product_name: d.product_name,
      product_type: d.product_type ?? null,
      quantity: d.quantity,
      unit: d.unit,
      price: d.price,
      currency_code: d.currency_code,
      price_basis: d.price_basis,
      origin: d.origin ?? null,
      delivery_location: d.delivery_location ?? null,
      delivery_terms: d.delivery_terms ?? null,
      payment_terms: d.payment_terms ?? null,
      description: d.description ?? null,
      terms_and_conditions: d.terms_and_conditions ?? null,
      interest_deadline: localDateTimeToIso(d.interest_deadline, tz),
      document_deadline: localDateTimeToIso(d.document_deadline, tz),
      timezone: tz,
    },
  } as const;
}

/** Create a new offer as DRAFT — numbered immediately by the DB trigger. */
export async function createTradeOfferDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const built = offerInsertPayload(f);
  if ("error" in built) return { error: built.error };
  const { supabase, userId } = await ctx();

  const { data, error } = await supabase
    .from("trade_offers")
    .insert({ ...built.data, created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  revalidatePath("/trade");
  redirect(`/trade/${data.id}`);
}

/** Replace a DRAFT offer's fields — RLS blocks this once status leaves DRAFT. */
export async function updateTradeOfferDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ آفر نامعتبر است." };
  const built = offerInsertPayload(f);
  if ("error" in built) return { error: built.error };
  const { supabase } = await ctx();

  const { error } = await supabase.from("trade_offers").update(built.data).eq("id", id);
  if (error) return { error: persianError(error.message) };

  await supabase.from("trade_offer_events").insert({
    offer_id: id,
    event_type: "OFFER_UPDATED",
    actor_type: "ADMIN",
  });

  revalidatePath(`/trade/${id}`);
  redirect(`/trade/${id}`);
}

/** DRAFT -> ACTIVE, gated can_approve_trade() inside the RPC. */
export async function publishTradeOffer(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ آفر نامعتبر است." };
  const { supabase } = await ctx();

  const { error } = await supabase.rpc("publish_trade_offer", { p_id: id });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/trade/${id}`);
  return null;
}

/** ACTIVE/EXPIRED -> CLOSED or CANCELLED. */
export async function setTradeOfferStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const newStatus = String(f.get("status") ?? "");
  if (!id || !["CLOSED", "CANCELLED"].includes(newStatus)) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();

  const { error } = await supabase.rpc("set_trade_offer_status", { p_id: id, p_new_status: newStatus });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/trade/${id}`);
  return null;
}

export async function extendTradeOfferDeadline(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = tradeDeadlineExtensionSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;

  const { data: offer } = await supabase.from("trade_offers").select("timezone").eq("id", d.offer_id).single();
  const tz = offer?.timezone ?? "Asia/Tehran";

  const { error } = await supabase.rpc("extend_trade_offer_deadline", {
    p_id: d.offer_id,
    p_deadline_type: d.deadline_type,
    p_new_value: localDateTimeToIso(d.new_value, tz),
    p_reason: d.reason ?? null,
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/trade/${d.offer_id}`);
  return null;
}

export type AssignBuyerResult = { error?: string; token?: string; assignmentId?: string };

/**
 * Generates the raw 256-bit token in Node, stores only its SHA-256 hash
 * (via the assign_trade_offer_buyer RPC), and returns the raw value ONCE
 * for the admin UI to display/copy. It is never recoverable afterward.
 */
export async function assignTradeOfferBuyer(_p: AssignBuyerResult | null, f: FormData): Promise<AssignBuyerResult> {
  const parsed = tradeBuyerAssignSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;

  const rawToken = generateBuyerToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + d.expires_in_days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.rpc("assign_trade_offer_buyer", {
    p_offer_id: d.offer_id,
    p_company_id: d.company_id,
    p_token_hash: tokenHash,
    p_token_expires_at: expiresAt,
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/trade/${d.offer_id}`);
  return { token: rawToken, assignmentId: data as string };
}

export async function revokeTradeOfferBuyer(_p: ActionState, f: FormData): Promise<ActionState> {
  const assignmentId = String(f.get("assignment_id") ?? "");
  const offerId = String(f.get("offer_id") ?? "");
  if (!assignmentId) return { error: "شناسهٔ دسترسی نامعتبر است." };
  const { supabase } = await ctx();

  const { error } = await supabase.rpc("revoke_trade_offer_buyer", { p_assignment_id: assignmentId });
  if (error) return { error: persianError(error.message) };

  if (offerId) revalidatePath(`/trade/${offerId}`);
  return null;
}

/** Revokes the current token and issues a brand new one for the same buyer. */
export async function regenerateTradeOfferBuyerToken(_p: AssignBuyerResult | null, f: FormData): Promise<AssignBuyerResult> {
  const assignmentId = String(f.get("assignment_id") ?? "");
  const offerId = String(f.get("offer_id") ?? "");
  const expiresInDaysRaw = String(f.get("expires_in_days") ?? "30");
  const expiresInDays = Math.min(365, Math.max(1, Number(expiresInDaysRaw) || 30));
  if (!assignmentId) return { error: "شناسهٔ دسترسی نامعتبر است." };
  const { supabase } = await ctx();

  const rawToken = generateBuyerToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.rpc("regenerate_trade_offer_buyer_token", {
    p_assignment_id: assignmentId,
    p_new_token_hash: tokenHash,
    p_new_token_expires_at: expiresAt,
  });
  if (error) return { error: persianError(error.message) };

  if (offerId) revalidatePath(`/trade/${offerId}`);
  return { token: rawToken, assignmentId: data as string };
}

/** Opportunistic ACTIVE->EXPIRED sweep — a UX nicety only; buyer-facing
 * authorization never relies on this having run (see the RPC's own
 * comment in the migration). Safe to call from any trade list/detail
 * page load. */
export async function syncTradeOffersExpiry(offerId?: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.rpc("sync_trade_offers_expiry", { p_id: offerId ?? null });
}

import "server-only";
import { z } from "zod";
import type { ActionDefinition } from "./types";

/** Read-only Trade Portal questions only (spec §46) — publish/buyer-issuance/deadline-extension stay out of the Assistant entirely, not just unconfirmed. */
export const listTradeOffers: ActionDefinition<{ status?: string }> = {
  name: "LIST_TRADE_OFFERS",
  description: "لیست آفرهای تجاری (پورتال معاملات). می‌توانید status را فیلتر کنید: ACTIVE, DRAFT, EXPIRED, CLOSED, CANCELLED.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ status: z.string().optional() }),
  requiredAccess: (p) => p.role === "ADMIN" || p.trade_role != null,
  handler: async (input, ctx) => {
    let q = ctx.supabase.from("trade_offers").select("id, offer_code, title, product_name, status, interest_deadline, document_deadline").order("created_at", { ascending: false }).limit(20);
    if (input.status) q = q.eq("status", input.status);
    const { data } = await q;
    const rows = data ?? [];
    return { data: rows, cards: rows.slice(0, 10).map((o) => ({ kind: "trade_offer" as const, id: o.id, title: `${o.offer_code} — ${o.title}`, href: `/trade/${o.id}` })) };
  },
};

export const getTradeOfferBuyers: ActionDefinition<{ offer_id: string }> = {
  name: "GET_TRADE_OFFER_BUYERS",
  description: "لیست خریداران تعیین‌شده برای یک آفر تجاری و آخرین پاسخ هرکدام. ابتدا با LIST_TRADE_OFFERS شناسهٔ آفر را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ offer_id: z.string().uuid() }),
  requiredAccess: (p) => p.role === "ADMIN" || p.trade_role != null,
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase
      .from("trade_offer_buyers")
      .select("id, revoked_at, last_viewed_at, companies(legal_name), trade_offer_responses(response_type, created_at)")
      .eq("offer_id", input.offer_id);
    return { data: data ?? [] };
  },
};

export const tradeActions: ActionDefinition<any>[] = [listTradeOffers, getTradeOfferBuyers];

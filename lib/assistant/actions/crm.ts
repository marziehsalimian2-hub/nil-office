import "server-only";
import { z } from "zod";
import type { ActionDefinition } from "./types";

export const getOpportunity: ActionDefinition<{ opportunity_id: string }> = {
  name: "GET_OPPORTUNITY",
  description: "جزئیات یک فرصت تجاری/فروش با شناسه. ابتدا با SEARCH_OPPORTUNITY شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ opportunity_id: z.string().uuid() }),
  requiredAccess: (p) => p.role === "ADMIN" || p.crm_role != null,
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase
      .from("crm_opportunities")
      .select("id, opportunity_number, title, estimated_value, currency_code, won_at, lost_at, next_action, next_action_date, description, companies(legal_name), crm_pipeline_stages(name)")
      .eq("id", input.opportunity_id)
      .single();
    if (!data) return { data: { note: "فرصتی با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return { data, cards: [{ kind: "opportunity", id: data.id, title: data.title, href: `/opportunities/${data.id}` }] };
  },
};

export const crmActions: ActionDefinition<any>[] = [getOpportunity];

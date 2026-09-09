import "server-only";
import { z } from "zod";
import type { ActionDefinition } from "./types";

export const getContract: ActionDefinition<{ contract_id: string }> = {
  name: "GET_CONTRACT",
  description: "جزئیات یک قرارداد مشخص با شناسه. ابتدا با SEARCH_CONTRACT شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ contract_id: z.string().uuid() }),
  requiredAccess: (p) => p.role === "ADMIN" || p.contract_role != null,
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase
      .from("contracts")
      .select("id, title, display_number, external_contract_number, status, effective_date, expiry_date, total_amount, currency_code, companies:counterparty_company_id(legal_name)")
      .eq("id", input.contract_id)
      .single();
    if (!data) return { data: { note: "قراردادی با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return { data, cards: [{ kind: "contract", id: data.id, title: data.display_number ?? data.title, href: `/contracts/${data.id}` }] };
  },
};

export const contractActions: ActionDefinition<any>[] = [getContract];

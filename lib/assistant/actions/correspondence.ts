import "server-only";
import { z } from "zod";
import type { ActionDefinition } from "./types";

export const getCorrespondence: ActionDefinition<{ correspondence_id: string }> = {
  name: "GET_CORRESPONDENCE",
  description: "جزئیات یک نامهٔ صادره/وارده مشخص با شناسه. ابتدا با SEARCH_CORRESPONDENCE شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ correspondence_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase
      .from("correspondence")
      .select("id, display_number, subject, direction, status, recipient_name, created_at, finalized_at")
      .eq("id", input.correspondence_id)
      .single();
    if (!data) return { data: { note: "نامه‌ای با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return { data, cards: [{ kind: "correspondence", id: data.id, title: data.subject ?? "(بدون موضوع)", href: `/correspondence/${data.id}` }] };
  },
};

export const correspondenceActions: ActionDefinition<any>[] = [getCorrespondence];

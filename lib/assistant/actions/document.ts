import "server-only";
import { z } from "zod";
import type { ActionDefinition } from "./types";

/**
 * v1 scope (spec §45): only metadata already in the `documents` table —
 * no OCR/content extraction, no new document-intelligence infrastructure.
 */
export const getDocumentMetadata: ActionDefinition<{ document_id: string }> = {
  name: "GET_DOCUMENT_METADATA",
  description: "اطلاعات یک سند بایگانی‌شده (عنوان، نوع، تاریخ) با شناسه — نه محتوای فایل. ابتدا با SEARCH_DOCUMENTS شناسه را پیدا کنید.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: z.object({ document_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase.from("documents").select("id, title, document_type, document_date, description").eq("id", input.document_id).single();
    if (!data) return { data: { note: "سندی با این شناسه پیدا نشد یا دسترسی ندارید." } };
    return { data, cards: [{ kind: "correspondence", id: data.id, title: data.title, href: `/documents/${data.id}` }] };
  },
};

export const documentActions: ActionDefinition<any>[] = [getDocumentMetadata];

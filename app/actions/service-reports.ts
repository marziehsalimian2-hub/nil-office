"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { reportBuilderSchema } from "@/lib/validation-service-ledger";
import { buildClientServiceReportPdf, type ReportBuilderParams } from "@/lib/pdf/clientServiceReportData";
import { REPORT_SECTION, REPORT_FIELD } from "@/lib/enums";

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

/** Defense in depth ahead of the DB trigger (tg_enforce_report_field_security, migration 0093) — same habit this codebase already has on other security-sensitive paths (e.g. billing batch guards re-validated in convert_billing_batch_to_sales_document despite RLS already gating insert). */
function assertAllowedSelection(sections: string[], fields: string[]) {
  const badSection = sections.find((s) => !(REPORT_SECTION as readonly string[]).includes(s));
  const badField = fields.find((f) => !(REPORT_FIELD as readonly string[]).includes(f));
  if (badSection || badField) throw new Error("CONFIDENTIAL_FIELD_NOT_ALLOWED");
}

/**
 * Persists an immutable archived report — builds the PDF via the same
 * buildClientServiceReportPdf() the preview route uses, uploads it to
 * the private nil-files bucket, then inserts the append-only
 * client_service_reports row. The id is generated client-side
 * (crypto.randomUUID, precedent: lib/trade/token.ts) because the
 * storage path must be known before the insert, and the table has no
 * UPDATE policy to patch it in afterward (immutability is enforced by
 * omission, not a trigger — see migration 0093's header comment).
 */
export async function generateClientServiceReportCore(
  supabase: SupabaseClient,
  userId: string,
  payload: ReportBuilderParams & { template_id?: string },
): Promise<{ data: { id: string } } | { error: string }> {
  assertAllowedSelection(payload.selected_sections, payload.selected_fields);

  let templateVersion: number | null = null;
  if (payload.template_id) {
    const { data: tpl } = await supabase.from("client_service_report_templates").select("version").eq("id", payload.template_id).single();
    templateVersion = tpl?.version ?? null;
  }

  const { buffer, fileName, dataAsOf } = await buildClientServiceReportPdf(supabase, payload);

  const reportId = randomUUID();
  const storagePath = `client-service-reports/${payload.client_service_file_id}/${reportId}.pdf`;

  const { error: uploadErr } = await supabase.storage.from("nil-files").upload(storagePath, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadErr) return { error: persianError(uploadErr.message) };

  const { data, error } = await supabase
    .from("client_service_reports")
    .insert({
      id: reportId,
      client_service_file_id: payload.client_service_file_id,
      report_type: payload.report_type,
      period_start: payload.period_start,
      period_end: payload.period_end,
      title: payload.title,
      introduction: payload.introduction || null,
      final_note: payload.final_note || null,
      selected_sections: payload.selected_sections,
      selected_fields: payload.selected_fields,
      detail_level: payload.detail_level,
      show_logo: payload.show_logo,
      show_page_numbers: payload.show_page_numbers,
      template_id: payload.template_id || null,
      template_version: templateVersion,
      data_as_of: dataAsOf,
      generated_by: userId,
      storage_path: storagePath,
      file_name: fileName,
    })
    .select("id")
    .single();

  if (error) {
    await supabase.storage.from("nil-files").remove([storagePath]);
    return { error: persianError(error.message) };
  }
  return { data };
}

export async function generateClientServiceReport(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = reportBuilderSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const result = await generateClientServiceReportCore(supabase, userId, parsed.data);
  if ("error" in result) return { error: result.error };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

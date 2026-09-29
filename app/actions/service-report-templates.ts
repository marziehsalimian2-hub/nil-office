"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { reportTemplateSchema } from "@/lib/validation-service-ledger";

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

export async function createReportTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = reportTemplateSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("client_service_report_templates").insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/report-templates");
  return null;
}

/** Plain in-place edit — no version bump (§62: only the explicit "Save Changes To Template" action below bumps version). */
export async function updateReportTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ قالب نامعتبر است." };
  const parsed = reportTemplateSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("client_service_report_templates").update(parsed.data).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/report-templates");
  return null;
}

/** §62 — the ONE action that commits a builder-wizard override back onto the template itself, bumping version so every future historical report correctly shows a newer template_version than reports generated before this change. */
export async function saveChangesToTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ قالب نامعتبر است." };
  const parsed = reportTemplateSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { data: current, error: fetchErr } = await supabase.from("client_service_report_templates").select("version").eq("id", id).single();
  if (fetchErr || !current) return { error: "قالب یافت نشد." };
  const { error } = await supabase
    .from("client_service_report_templates")
    .update({ ...parsed.data, version: current.version + 1 })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/report-templates");
  return null;
}

/** §63 — copies every column except id/created_at/updated_at, resets version=1. */
export async function duplicateReportTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ قالب نامعتبر است." };
  const { supabase, userId } = await ctx();
  const { data: original, error: fetchErr } = await supabase.from("client_service_report_templates").select("*").eq("id", id).single();
  if (fetchErr || !original) return { error: "قالب یافت نشد." };
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, version: _version, ...rest } = original;
  const { error } = await supabase.from("client_service_report_templates").insert({
    ...rest,
    template_name: `${original.template_name} (کپی)`,
    version: 1,
    created_by: userId,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/report-templates");
  return null;
}

/** §67 — deactivate, never hard-delete (no DELETE RLS policy exists on this table at all — see migration 0094). */
export async function deactivateReportTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ قالب نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("client_service_report_templates").update({ is_active: false }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/report-templates");
  return null;
}

/** §60 — per-client default, drives §61's "گزارش دوره‌ای" quick-generation shortcut. */
export async function setDefaultClientTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  const clientServiceFileId = String(f.get("client_service_file_id") ?? "");
  const templateId = String(f.get("template_id") ?? "") || null;
  const companyId = String(f.get("company_id") ?? "");
  if (!clientServiceFileId) return { error: "پروندهٔ خدمات نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("client_service_files").update({ default_report_template_id: templateId }).eq("id", clientServiceFileId);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

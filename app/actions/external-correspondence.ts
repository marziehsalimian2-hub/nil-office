"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { sanitizeLetterHtml } from "@/lib/sanitize-html";
import { insertFollowupDraftCore } from "@/app/actions/entities";
import { followupSchema } from "@/lib/validation";
import { sendMessage } from "@/lib/external-bot/telegram/bot";

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

/**
 * Accept & Register (spec §21/§22) — thin wrapper around the
 * SECURITY DEFINER external_intake_accept_and_register (migration
 * 0099), which does the real transactional work (creates the
 * correspondence row, calls the EXISTING register_incoming RPC,
 * updates the intake). This action's only job beyond the RPC call is
 * sanitizing the intake's plain-text description into the draft_text
 * HTML column exactly the way createAndRegisterIncomingCore already
 * does for its own body_summary field (sanitizeLetterHtml on raw text
 * is this codebase's established defense — the sanitizer strips/escapes
 * anything tag-like, safe for untrusted external plain text).
 */
export async function acceptAndRegisterExternalIntake(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const companyId = String(f.get("company_id") ?? "") || null;
  const caseId = String(f.get("case_id") ?? "") || null;
  const assignedTo = String(f.get("assigned_to") ?? "") || null;
  const descriptionRaw = String(f.get("description") ?? "");
  if (!intakeId) return { error: "شناسهٔ مکاتبه نامعتبر است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("external_intake_accept_and_register", {
    p_intake_id: intakeId,
    p_draft_text_html: descriptionRaw ? sanitizeLetterHtml(descriptionRaw) : null,
    p_company_id: companyId,
    p_case_id: caseId,
    p_assigned_to: assignedTo,
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath("/correspondence/external");
  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

export async function rejectExternalIntake(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const internalReason = String(f.get("internal_reason") ?? "").trim();
  const publicReason = String(f.get("public_reason") ?? "").trim() || null;
  if (!intakeId) return { error: "شناسهٔ مکاتبه نامعتبر است." };
  if (!internalReason) return { error: "دلیل داخلی رد الزامی است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("external_intake_reject", {
    p_intake_id: intakeId,
    p_internal_reason: internalReason,
    p_public_reason: publicReason,
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath("/correspondence/external");
  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

/**
 * Request More Information (spec §27) — after the DB status flips to
 * NEEDS_INFORMATION, sends the actual Telegram message to the sender's
 * own chat via the EXTERNAL bot (never the internal bot). Message
 * delivery failure doesn't roll back the status change — the reviewer
 * can already see the status changed; a failed notification is logged,
 * matching this codebase's existing tolerance for "the record is
 * correct, delivery is best-effort" (same shape as deliverDocumentPdf's
 * own failure handling in the internal bot).
 */
export async function requestExternalIntakeInformation(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const message = String(f.get("message") ?? "").trim();
  if (!intakeId) return { error: "شناسهٔ مکاتبه نامعتبر است." };
  if (!message) return { error: "متن پیام الزامی است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("external_intake_request_information", { p_intake_id: intakeId, p_message: message });
  if (error) return { error: persianError(error.message) };

  const { data: intake } = await supabase.from("external_intakes").select("telegram_chat_id").eq("id", intakeId).single();
  if (intake?.telegram_chat_id) {
    try {
      await sendMessage(intake.telegram_chat_id, `برای ادامه بررسی مکاتبه، لطفاً اطلاعات/مدرک زیر را ارسال نمایید:\n\n${message}`);
    } catch (err) {
      console.error("[external-correspondence] requestExternalIntakeInformation: delivery failed", err);
    }
  }

  revalidatePath("/correspondence/external");
  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

export async function assignExternalIntake(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const assignedTo = String(f.get("assigned_to") ?? "") || null;
  if (!intakeId) return { error: "شناسهٔ مکاتبه نامعتبر است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("external_intake_assign", { p_intake_id: intakeId, p_assigned_to: assignedTo });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

export async function linkExternalIntakeCompany(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!intakeId || !companyId) return { error: "ورودی نامعتبر است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("external_intake_link_company", { p_intake_id: intakeId, p_company_id: companyId });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

export async function linkExternalIntakeCase(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const caseId = String(f.get("case_id") ?? "");
  if (!intakeId || !caseId) return { error: "ورودی نامعتبر است." };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("external_intake_link_case", { p_intake_id: intakeId, p_case_id: caseId });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

/** Create Follow-up (spec §26) — reuses the EXISTING Follow-up engine unchanged, never a parallel one. Only meaningful once the intake has an official_correspondence_id (a Follow-up FKs to a real correspondence row). */
export async function createFollowupForExternalIntake(_p: ActionState, f: FormData): Promise<ActionState> {
  const intakeId = String(f.get("intake_id") ?? "");
  const parsed = followupSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase, userId } = await ctx();
  const result = await insertFollowupDraftCore(supabase, userId, parsed.data);
  if ("error" in result) return { error: result.error };

  revalidatePath(`/correspondence/external/${intakeId}`);
  return null;
}

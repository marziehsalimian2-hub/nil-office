"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { retryVerification } from "@/lib/verify/hooks";
import { layoutSchema } from "@/lib/verify/layout";
import { VERIFY_DOCUMENT_TYPES } from "@/lib/verify/types";

export type VerifyActionState = { error?: string; ok?: boolean; message?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}
const entries = (f: FormData) => Object.fromEntries(f.entries());

const uuid = z.string().uuid();
const docType = z.enum(VERIFY_DOCUMENT_TYPES);
// the page to refresh: only the document detail routes and settings are accepted (never an arbitrary path from the browser)
const revalidateTarget = z.string().regex(/^\/(correspondence|invoices|contracts|board\/meetings)\/[0-9a-f-]{36}$|^\/settings$/);
const reason = z.string().trim().min(3, "درج دلیل (حداقل ۳ نویسه) الزامی است.").max(500);

const refresh = (path: string | undefined) => {
  const p = revalidateTarget.safeParse(path);
  if (p.success) revalidatePath(p.data);
};

/** Retry of a PENDING verification (the finalize step succeeded but PDF / hash / storage failed). Idempotent. */
export async function retryDocumentVerification(_p: VerifyActionState, f: FormData): Promise<VerifyActionState> {
  const parsed = z.object({ type: docType, id: uuid, revalidate: z.string().optional() }).safeParse(entries(f));
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();
  const r = await retryVerification(supabase, userId, parsed.data.type, parsed.data.id);
  refresh(parsed.data.revalidate);
  if (r.status === "ACTIVE") return { ok: true, message: "کد استعلام فعال شد." };
  if (r.status === "DISABLED") return { error: "استعلام اصالت برای این نوع سند غیرفعال است." };
  return { error: persianError(r.error) };
}

/** ADMIN only (enforced in the database): revoke a verification. The public page keeps answering — it just says «ابطال شده». */
export async function revokeVerificationAction(_p: VerifyActionState, f: FormData): Promise<VerifyActionState> {
  const parsed = z.object({ verification_id: uuid, reason, revalidate: z.string().optional() }).safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("verify_revoke", { p_id: parsed.data.verification_id, p_reason: parsed.data.reason });
  if (error) return { error: persianError(error.message) };
  refresh(parsed.data.revalidate);
  return { ok: true, message: "استعلام ابطال شد." };
}

/** ADMIN only: mark this verification as replaced by another ACTIVE one of the same document type. */
export async function supersedeVerificationAction(_p: VerifyActionState, f: FormData): Promise<VerifyActionState> {
  const parsed = z.object({ old_id: uuid, new_id: uuid, reason, revalidate: z.string().optional() }).safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("verify_supersede", { p_old: parsed.data.old_id, p_new: parsed.data.new_id, p_reason: parsed.data.reason });
  if (error) return { error: persianError(error.message) };
  refresh(parsed.data.revalidate);
  return { ok: true, message: "سند به‌عنوان جایگزین‌شده ثبت شد." };
}

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export async function saveVerifySettings(_p: VerifyActionState, f: FormData): Promise<VerifyActionState> {
  const parsed = z
    .object({
      enabled: checkbox,
      show_contract_amount: checkbox,
      issuer_name: z.string().trim().min(1).max(200),
      public_label: z.string().trim().min(1).max(120),
    })
    .strict()
    .safeParse(entries(f));
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("verify_update_settings", {
    p_enabled: parsed.data.enabled,
    p_issuer_name: parsed.data.issuer_name,
    p_public_label: parsed.data.public_label,
    p_show_contract_amount: parsed.data.show_contract_amount,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return { ok: true, message: "تنظیمات ذخیره شد." };
}

export async function saveVerifyDocType(_p: VerifyActionState, f: FormData): Promise<VerifyActionState> {
  const raw = entries(f);
  const parsed = z
    .object({ document_type: docType, enabled: checkbox })
    .strict()
    .safeParse({ document_type: raw.document_type, enabled: raw.enabled });
  const layout = layoutSchema.safeParse({
    page: raw.page, x_mm: raw.x_mm, y_mm: raw.y_mm, size_mm: raw.size_mm,
    show_label: raw.show_label === "on", show_code: raw.show_code === "on", label_text: raw.label_text,
  });
  if (!parsed.success || !layout.success) return { error: "چیدمان نامعتبر است (مقادیر و محدوده‌ها را بررسی کنید)." };
  const { supabase } = await ctx();
  const l = layout.data;
  const { error } = await supabase.rpc("verify_update_doc_type", {
    p_type: parsed.data.document_type, p_enabled: parsed.data.enabled, p_page: l.page, p_x: l.x_mm, p_y: l.y_mm, p_size: l.size_mm,
    p_show_label: l.show_label, p_show_code: l.show_code, p_label_text: l.label_text,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return { ok: true, message: "چیدمان ذخیره شد." };
}

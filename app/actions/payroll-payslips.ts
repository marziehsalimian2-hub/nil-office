"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { loadPayslipPdfInput } from "@/lib/pdf/payslipData";
import { renderPayslipPdf } from "@/lib/pdf/renderPayslipPdf";
import { payslipFileName } from "@/lib/payroll/payslip";
import { linkProfileSchema } from "@/lib/validation-payroll";

export type ActionState = { error?: string; ok?: boolean; revision?: number } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

/**
 * Issues ONE payslip (one request per employee — the UI loops, so there is no timeout on big batches).
 * data RPC (approved + complete only) → render PDF → upload with upsert:false → register (the DB re-derives the payment state
 * and refuses an unchanged state) → remove the object if registration fails. An issued PDF is never edited or overwritten.
 */
export async function issuePayslip(_p: ActionState, f: FormData): Promise<ActionState> {
  const resultId = String(f.get("result_id") ?? "");
  const batchId = String(f.get("batch_id") ?? "");
  if (!resultId) return { error: "شناسهٔ نتیجه نامعتبر است." };
  const { supabase } = await ctx();

  let loaded;
  try {
    loaded = await loadPayslipPdfInput(supabase, resultId);
  } catch (e) {
    return { error: persianError(e instanceof Error ? e.message : undefined) };
  }
  const { data, input } = loaded;
  if (!data.can_issue) return { error: persianError("PAYSLIP_UP_TO_DATE") };

  let buffer: Buffer;
  try {
    buffer = await renderPayslipPdf(input);
  } catch (e) {
    console.error("issuePayslip: render failed", e);
    return { error: "تولید PDF فیش ناموفق بود." };
  }

  const payslipId = randomUUID();
  const path = `payslips/${data.personnel_id}/${payslipId}.pdf`;
  const fileName = payslipFileName(data.personnel.number, data.period.jalali_year, data.period.jalali_month, data.next_revision);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error: upErr } = await supabase.storage.from("nil-files").upload(path, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    console.error("issuePayslip: upload failed", upErr);
    return { error: "ذخیرهٔ فایل فیش ناموفق بود." };
  }
  const { error: regErr } = await supabase.rpc("register_payroll_payslip", {
    p_result_id: resultId, p_payslip_id: payslipId, p_storage_path: path, p_file_name: fileName,
    p_size: buffer.length, p_sha256: sha256, p_state: data.payment.state,
  });
  if (regErr) {
    await supabase.storage.from("nil-files").remove([path]);
    return { error: persianError(regErr.message) };
  }
  if (batchId) revalidatePath(`/payroll/batches/${batchId}`);
  return { ok: true, revision: data.next_revision };
}

/** HR admin: link (or unlink) a personnel record to a login. Needed for employee self-service. */
export async function linkPersonnelProfile(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = linkProfileSchema.safeParse(Object.fromEntries(f.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("set_personnel_profile", { p_personnel_id: d.personnel_id, p_profile_id: d.profile_id ?? null });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${d.personnel_id}`);
  return { ok: true };
}

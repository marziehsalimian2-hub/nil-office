import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { PayslipData } from "@/lib/payroll/payslip";
import type { PayslipPdfInput } from "@/lib/pdf/renderPayslipPdf";

const NIL_LEGAL_NAME = "شرکت مدیریت راهبردی نیل";   // same constant the contract/invoice renderers use (no company-name setting exists)

const EXT_TO_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
async function pathToDataUri(supabase: SupabaseClient, storagePath: string | null | undefined): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = EXT_TO_MIME[storagePath.slice(storagePath.lastIndexOf(".") + 1).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Wall-clock Tehran time «HH:MM» for the «تاریخ صدور» line (date part is Jalali). */
function tehranTime(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * Loads everything for ONE payslip through the caller's RLS-bound client: the payroll_payslip_data RPC (APPROVE tier,
 * approved + complete results only) and the existing letterhead/stamp branding. Returns null `input` data check via `data.can_issue`.
 */
export async function loadPayslipPdfInput(
  supabase: SupabaseClient,
  resultId: string,
  now: Date = new Date(),
): Promise<{ data: PayslipData; input: PayslipPdfInput }> {
  const { data, error } = await supabase.rpc("payroll_payslip_data", { p_result_id: resultId });
  if (error || !data) throw Object.assign(new Error(error?.message ?? "NOT_FOUND"), { rpc: true });
  const d = data as PayslipData;

  const { data: settings } = await supabase.from("app_settings").select("letterhead_path, stamp_path").eq("id", 1).single();
  const s = settings as { letterhead_path: string | null; stamp_path: string | null } | null;
  const [letterheadDataUri, stampDataUri] = await Promise.all([pathToDataUri(supabase, s?.letterhead_path), pathToDataUri(supabase, s?.stamp_path)]);

  return {
    data: d,
    input: {
      data: d,
      revision: d.next_revision,
      companyName: NIL_LEGAL_NAME,
      issuedAtLabel: `${formatJalali(now)} — ${toFaDigits(tehranTime(now))}`,
      stampDataUri,
      letterheadDataUri,
    },
  };
}

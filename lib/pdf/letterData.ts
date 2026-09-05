import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { renderLetterPdf } from "@/lib/pdf/renderLetterPdf";

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function extOf(p: string): string {
  return p.slice(p.lastIndexOf(".") + 1).toLowerCase();
}

async function pathToDataUri(
  supabase: SupabaseClient,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = EXT_TO_MIME[extOf(storagePath)] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Loads everything needed to render a given outgoing letter (branding
 * images, signatory, recipient) and returns the finished PDF bytes.
 * Shared by the on-demand preview route and the finalize-time archival
 * step, so both always produce the same layout from the same data.
 */
export async function buildLetterPdfForCorrespondence(
  supabase: SupabaseClient,
  correspondenceId: string,
): Promise<Buffer> {
  const { data: letter, error } = await supabase
    .from("correspondence")
    .select(
      "id, display_number, subject, draft_text, recipient_name, recipient_company_id, signatory_id, signatory_label, finalized_at, created_at",
    )
    .eq("id", correspondenceId)
    .single();
  if (error || !letter) throw new Error("نامه یافت نشد.");

  const [{ data: settings }, companyRes, signatoryRes] = await Promise.all([
    supabase.from("app_settings").select("letterhead_path, stamp_path").eq("id", 1).single(),
    letter.recipient_company_id
      ? supabase.from("companies").select("legal_name").eq("id", letter.recipient_company_id).single()
      : Promise.resolve({ data: null }),
    letter.signatory_id
      ? supabase.from("profiles").select("signature_path").eq("id", letter.signatory_id).single()
      : Promise.resolve({ data: null }),
  ]);
  const recipientCompany = companyRes.data;
  const signatory = signatoryRes.data;

  const [letterheadDataUri, stampDataUri, signatureDataUri] = await Promise.all([
    pathToDataUri(supabase, settings?.letterhead_path),
    pathToDataUri(supabase, settings?.stamp_path),
    pathToDataUri(supabase, signatory?.signature_path),
  ]);

  return renderLetterPdf({
    displayNumber: letter.display_number ? toFaDigits(letter.display_number) : null,
    dateLabel: formatJalali(letter.finalized_at ?? letter.created_at),
    recipientLabel: recipientCompany?.legal_name ?? letter.recipient_name ?? null,
    subject: letter.subject,
    bodyHtml: letter.draft_text ?? "",
    signatoryLabel: letter.signatory_label,
    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  });
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali } from "@/lib/jalali";
import { renderContractPdf } from "@/lib/pdf/renderContractPdf";

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

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Plain textarea text -> safe HTML for the contract body slot. Every
 * newline becomes a line break, including leading/trailing blank ones —
 * pressing Enter at the top to push the text down must actually show up
 * in the PDF, not get trimmed away.
 */
function textToHtml(text: string | null): string {
  if (!text) return "";
  return `<p>${escHtml(text).replace(/\n/g, "<br/>")}</p>`;
}

/**
 * Renders the contract's own description text (not an auto-generated legal
 * clause set — out of scope per the module spec) onto the company
 * letterhead, followed by a two-party signoff table: the counterparty's
 * side is left blank for their own hand-written signature (they're not a
 * system user), NIL's side is auto-filled from the chosen signatory.
 */
export async function buildContractPdf(supabase: SupabaseClient, contractId: string): Promise<Buffer> {
  const { data: contract, error } = await supabase
    .from("contracts")
    .select(
      "id, title, display_number, external_contract_number, counterparty_company_id, counterparty_representative_name, description, signatory_id, approved_at, finalized_at, created_at",
    )
    .eq("id", contractId)
    .single();
  if (error || !contract) throw new Error("قرارداد یافت نشد.");

  const [{ data: settings }, companyRes, signatoryRes] = await Promise.all([
    supabase.from("app_settings").select("letterhead_path, stamp_path").eq("id", 1).single(),
    contract.counterparty_company_id
      ? supabase.from("companies").select("legal_name").eq("id", contract.counterparty_company_id).single()
      : Promise.resolve({ data: null }),
    contract.signatory_id
      ? supabase.from("profiles").select("full_name, title, signature_path").eq("id", contract.signatory_id).single()
      : Promise.resolve({ data: null }),
  ]);
  const counterparty = companyRes.data;
  const signatory = signatoryRes.data;

  const [letterheadDataUri, stampDataUri, signatureDataUri] = await Promise.all([
    pathToDataUri(supabase, settings?.letterhead_path),
    pathToDataUri(supabase, settings?.stamp_path),
    pathToDataUri(supabase, signatory?.signature_path),
  ]);

  return renderContractPdf({
    displayNumber: contract.display_number ?? contract.external_contract_number,
    dateLabel: formatJalali(contract.finalized_at ?? contract.created_at),
    recipientLabel: counterparty?.legal_name ?? null,
    subject: contract.title,
    bodyHtml: textToHtml(contract.description),
    counterpartyLabel: counterparty?.legal_name ?? null,
    counterpartyRepresentativeName: contract.counterparty_representative_name,
    nilSignatoryName: signatory?.full_name ?? null,
    nilSignatoryTitle: signatory?.title ?? null,
    nilDateLabel: contract.approved_at ? formatJalali(contract.approved_at) : null,
    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  });
}

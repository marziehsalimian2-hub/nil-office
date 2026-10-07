import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifyDocumentStatus, VerifyDocumentType, VerifyStatus } from "./types";

/** Verification status of one document (module-access gated RPC). Any failure reads as "no verification" for display purposes. */
export async function getVerifyStatus(supabase: SupabaseClient, type: VerifyDocumentType, id: string): Promise<VerifyDocumentStatus> {
  const { data, error } = await supabase.rpc("verify_document_status", { p_type: type, p_id: id });
  if (error || !data) return { exists: false };
  return data as VerifyDocumentStatus;
}

/**
 * The frozen, verified PDF of a document, or null when the document has no (usable) verification and the caller should keep the normal
 * on-demand rendering. Once a verification exists, a missing file is an ERROR, never a silent re-render: a re-render would produce
 * different bytes than the hash on record and defeat the purpose.
 */
export async function getFrozenPdf(
  supabase: SupabaseClient, type: VerifyDocumentType, id: string,
): Promise<{ buffer: Buffer; number: string; status: VerifyStatus } | null> {
  const st = await getVerifyStatus(supabase, type, id);
  if (!st.exists || st.status === "PENDING" || !st.pdf_storage_path) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(st.pdf_storage_path);
  if (error || !data) throw new Error("VERIFY_FROZEN_PDF_MISSING");
  return { buffer: Buffer.from(await data.arrayBuffer()), number: st.document_number, status: st.status };
}

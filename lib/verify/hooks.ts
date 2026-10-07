import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLetterPdfForCorrespondence } from "@/lib/pdf/letterData";
import { buildInvoicePdf } from "@/lib/pdf/invoiceData";
import { buildContractPdf } from "@/lib/pdf/contractData";
import { issueDocumentVerification, type IssueResult } from "./issue";
import type { VerifyDocumentType } from "./types";

/**
 * The call sites' entry points (kept out of the "use server" action files, which may only export actions).
 * Each is called AFTER the module's own finalize RPC succeeded; none can fail the finalization (they return a result instead of throwing).
 */

export function issueLetterVerification(supabase: SupabaseClient, userId: string, letterId: string): Promise<IssueResult> {
  return issueDocumentVerification({
    supabase, userId, type: "OUTGOING_CORRESPONDENCE", documentId: letterId,
    buildPdf: ({ minBottomMarginMm }) => buildLetterPdfForCorrespondence(supabase, letterId, { minBottomMarginMm }),
  });
}

export async function issueSalesDocumentVerification(supabase: SupabaseClient, userId: string, docId: string): Promise<IssueResult> {
  const { data: doc } = await supabase.from("sales_documents").select("type").eq("id", docId).maybeSingle();
  const type = doc?.type as VerifyDocumentType | undefined;
  if (type !== "PROFORMA" && type !== "INVOICE") return { status: "UNAVAILABLE", error: "VERIFY_DOCUMENT_NOT_FOUND" };
  return issueDocumentVerification({
    supabase, userId, type, documentId: docId,
    buildPdf: ({ minBottomMarginMm }) => buildInvoicePdf(supabase, docId, { minBottomMarginMm }),
  });
}

export function issueContractVerification(supabase: SupabaseClient, userId: string, contractId: string): Promise<IssueResult> {
  return issueDocumentVerification({
    supabase, userId, type: "CONTRACT", documentId: contractId,
    buildPdf: ({ minBottomMarginMm }) => buildContractPdf(supabase, contractId, { minBottomMarginMm }),
  });
}

/** Retry of a PENDING verification (detail-page button). Dispatches by document type. */
export async function retryVerification(supabase: SupabaseClient, userId: string, type: VerifyDocumentType, documentId: string): Promise<IssueResult> {
  if (type === "OUTGOING_CORRESPONDENCE") return issueLetterVerification(supabase, userId, documentId);
  if (type === "CONTRACT") return issueContractVerification(supabase, userId, documentId);
  return issueSalesDocumentVerification(supabase, userId, documentId);
}

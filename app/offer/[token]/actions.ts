"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { persianError } from "@/lib/enums";
import { hashToken, generateDocumentId } from "@/lib/trade/token";
import { tradeResponseSchema, tradeDocumentTypeSchema } from "@/lib/validation-trade";
import {
  validateTradeDocumentUpload,
  extensionOf,
  checkTradeDocumentSignature,
} from "@/lib/upload-validation";

export type ActionState = { error?: string; ok?: boolean } | null;
export type UploadActionState =
  | { error?: string; ok?: boolean; fileName?: string; documentType?: string; uploadedAt?: string }
  | null;

const entries = (f: FormData) => Object.fromEntries(f.entries());

/**
 * Buyer response submission. Every check (token validity, revocation,
 * expiry, offer status, interest deadline) is re-derived from scratch
 * INSIDE trade_submit_response() — this action does no authorization of
 * its own, it only forwards the token hash and lets the DB be the sole
 * source of truth (spec §34).
 */
export async function submitTradeResponse(token: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  const parsed = tradeResponseSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = createServiceClient();
  const { error } = await supabase.rpc("trade_submit_response", {
    p_token_hash: hashToken(token),
    p_response_type: parsed.data.response_type,
    p_explanation: parsed.data.explanation ?? null,
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/offer/${token}`);
  return { ok: true };
}

/**
 * Buyer document (LOI/ICPO) upload. Storage path is deterministic
 * (spec §28) and built from the offer/assignment ids resolved fresh
 * from the token hash — never from anything the browser supplies.
 * trade_record_document_upload() re-validates the document deadline
 * server-side before recording the row, exactly like the response path.
 */
export async function uploadTradeDocument(token: string, _prev: UploadActionState, f: FormData): Promise<UploadActionState> {
  const documentType = tradeDocumentTypeSchema.safeParse(f.get("document_type"));
  if (!documentType.success) return { error: "نوع مدرک نامعتبر است." };
  const file = f.get("file");
  if (!(file instanceof File)) return { error: "فایلی انتخاب نشده است." };

  const check = validateTradeDocumentUpload(file.name, file.type, file.size);
  if (!check.ok) return { error: check.error };

  const supabase = createServiceClient();
  const tokenHash = hashToken(token);

  // Resolve offer_id/assignment_id for the storage path only — this is
  // NOT the authorization boundary. A cheap early-exit here just avoids
  // uploading bytes for an obviously-dead link; trade_record_document_
  // upload() below is what actually enforces revocation/expiry/deadline.
  const { data: assignment } = await supabase
    .from("trade_offer_buyers")
    .select("id, offer_id, revoked_at, token_expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!assignment) return { error: "این لینک معتبر نیست." };
  if (assignment.revoked_at) return { error: "دسترسی این لینک لغو شده است." };
  if (new Date(assignment.token_expires_at) < new Date()) return { error: "اعتبار این لینک به پایان رسیده است." };

  const ext = extensionOf(file.name);
  if (ext) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!checkTradeDocumentSignature(ext, head)) return { error: "محتوای فایل با پسوند آن هم‌خوان نیست." };
  }

  const documentId = generateDocumentId();
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
  const path = `trade/offers/${assignment.offer_id}/buyers/${assignment.id}/${documentId}/${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("nil-files")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) {
    console.error("uploadTradeDocument: storage upload failed", upErr);
    return { error: "بارگذاری فایل ناموفق بود." };
  }

  const { error: rpcErr } = await supabase.rpc("trade_record_document_upload", {
    p_token_hash: tokenHash,
    p_document_id: documentId,
    p_document_type: documentType.data,
    p_storage_path: path,
    p_file_name: file.name,
    p_mime_type: file.type || "application/octet-stream",
    p_size_bytes: file.size,
  });
  if (rpcErr) {
    await supabase.storage.from("nil-files").remove([path]);
    return { error: persianError(rpcErr.message) };
  }

  revalidatePath(`/offer/${token}`);
  return { ok: true, fileName: file.name, documentType: documentType.data, uploadedAt: new Date().toISOString() };
}

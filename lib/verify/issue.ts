import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildVerifyUrl } from "./format";
import { plateTopMm } from "./layout";
import { stampVerificationQr } from "./stamp";
import { generateVerifyToken, hashVerifyToken, sha256Hex } from "./token";
import { verifiedPdfPath, type VerifyConfig, type VerifyDocumentType } from "./types";

/**
 * Issues the verification of ONE finalized document — the single shared implementation behind letters, proformas, invoices and contracts.
 *
 *   config -> begin (PENDING, unguessable token hash) -> render the document PDF -> overlay the QR -> freeze + SHA-256 of THOSE bytes
 *   -> store privately (verified/<id>.pdf) -> activate (hash + path registered, status ACTIVE)
 *
 * The official number is issued by the module's own finalize RPC BEFORE this runs and is never undone. If anything after `begin` fails the
 * verification simply stays PENDING (it can never become ACTIVE without a stored file and a hash) and the caller shows a retry; this function is
 * idempotent: a retry reuses the single PENDING record, an ACTIVE one is a no-op.
 */

export type PdfBuilder = (opts: { minBottomMarginMm: number }) => Promise<{ buffer: Buffer; fileName: string }>;

export type IssueResult =
  | { status: "DISABLED" }
  | { status: "UNAVAILABLE"; error: string }     // configuration could not be read (e.g. migration not applied): the caller keeps its legacy behaviour
  | { status: "ACTIVE"; code: string; alreadyActive: boolean }
  | { status: "PENDING"; error: string; code?: string };

const ATTACH_ENTITY: Record<VerifyDocumentType, string> = {
  OUTGOING_CORRESPONDENCE: "CORRESPONDENCE",
  PROFORMA: "SALES_DOCUMENT",
  INVOICE: "SALES_DOCUMENT",
  CONTRACT: "CONTRACT",
  BOARD_MINUTES: "BOARD_MEETING",
};

export async function issueDocumentVerification(args: {
  supabase: SupabaseClient;
  userId: string;
  type: VerifyDocumentType;
  documentId: string;
  buildPdf: PdfBuilder;
  baseUrl?: string | null;
}): Promise<IssueResult> {
  const { supabase, userId, type, documentId } = args;
  let code: string | undefined;
  try {
    const { data: cfgRaw, error: cfgErr } = await supabase.rpc("verify_get_config", { p_type: type });
    if (cfgErr || !cfgRaw) {
      console.error("issueDocumentVerification: configuration unavailable - verification skipped", type, cfgErr?.message);
      return { status: "UNAVAILABLE", error: cfgErr?.message ?? "VERIFY_CONFIG_MISSING" };
    }
    const cfg = cfgRaw as VerifyConfig;
    if (!cfg.enabled || !cfg.layout) return { status: "DISABLED" };

    const token = generateVerifyToken();
    const { data: begin, error: beginErr } = await supabase.rpc("verify_begin", { p_type: type, p_id: documentId, p_token_hash: hashVerifyToken(token) });
    if (beginErr) throw new Error(beginErr.message);
    const b = begin as { id: string; status: string; code: string; already_active?: boolean };
    code = b.code;
    if (b.status === "ACTIVE") return { status: "ACTIVE", code: b.code, alreadyActive: true };

    const url = buildVerifyUrl(args.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL, token);

    // the document itself (existing renderer), with enough bottom margin that the plate cannot touch content
    const { buffer, fileName } = await args.buildPdf({ minBottomMarginMm: Math.ceil(plateTopMm(cfg.layout) + 4) });
    // QR first, hash second: the hash covers exactly the bytes that are stored and downloaded
    const stamped = await stampVerificationQr(buffer, { url, code: b.code, layout: cfg.layout });
    const hash = sha256Hex(stamped.bytes);

    const path = verifiedPdfPath(b.id);
    const { error: upErr } = await supabase.storage.from("nil-files").upload(path, stamped.bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error("VERIFY_STORAGE_FAILED");

    const { error: actErr } = await supabase.rpc("verify_activate", { p_id: b.id, p_hash: hash, p_size: stamped.bytes.length, p_path: path });
    if (actErr) throw new Error(actErr.message);

    // registry row so the file shows up with the document's other attachments (best effort: the verification is already ACTIVE)
    try {
      const { data: existing } = await supabase.from("attachments").select("id").eq("storage_path", path).maybeSingle();
      if (!existing) {
        await supabase.from("attachments").insert({
          entity_type: ATTACH_ENTITY[type], entity_id: documentId, file_name: fileName, storage_path: path,
          mime_type: "application/pdf", size_bytes: stamped.bytes.length, uploaded_by: userId,
        });
      }
    } catch (e) {
      console.error("issueDocumentVerification: attachment registry failed (verification is ACTIVE)", e);
    }
    return { status: "ACTIVE", code: b.code, alreadyActive: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "VERIFY_FAILED";
    console.error("issueDocumentVerification failed — verification stays PENDING", type, documentId, message);
    return { status: "PENDING", error: message, code };
  }
}

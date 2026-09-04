"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import {
  validateUpload,
  isUuid,
  extensionOf,
  signatureCheckable,
  checkSignature,
} from "@/lib/upload-validation";

export type ActionState = { error?: string } | null;

// entity_type -> { nav path, DB table used to confirm the target exists }
const ENTITY_MAP: Record<string, { path: string; table: string }> = {
  CORRESPONDENCE: { path: "/correspondence", table: "correspondence" },
  DOCUMENT: { path: "/documents", table: "documents" },
  CASE: { path: "/cases", table: "cases" },
  CONTRACT: { path: "/contracts", table: "contracts" },
  SALES_DOCUMENT: { path: "/invoices", table: "sales_documents" },
  COMPANY: { path: "/companies", table: "companies" },
  OPPORTUNITY: { path: "/opportunities", table: "crm_opportunities" },
};

/** Upload a file to the private bucket and record its metadata. */
export async function uploadAttachment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const entityType = String(formData.get("entity_type") ?? "");
  const entityId = String(formData.get("entity_id") ?? "");
  const file = formData.get("file");

  const target = ENTITY_MAP[entityType];
  if (!target) return { error: "نوع موجودیت نامعتبر است." };
  if (!isUuid(entityId)) return { error: "شناسهٔ موجودیت نامعتبر است." };
  if (!(file instanceof File)) return { error: "فایلی انتخاب نشده است." };

  const check = validateUpload(file.name, file.type, file.size);
  if (!check.ok) return { error: check.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify the target entity exists AND the caller may access it. The SELECT
  // is governed by RLS, so a row is returned only when the authenticated
  // caller is authorized to read that entity; otherwise the upload is refused.
  const { data: entity, error: entErr } = await supabase
    .from(target.table)
    .select("id")
    .eq("id", entityId)
    .maybeSingle();
  if (entErr) return { error: persianError(entErr.message) };
  if (!entity) return { error: "موجودیت مقصد یافت نشد یا دسترسی مجاز نیست." };

  // Lightweight file-signature check for formats with reliable magic bytes.
  const ext = extensionOf(file.name);
  if (signatureCheckable(ext)) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!checkSignature(ext as string, head))
      return { error: "محتوای فایل با پسوند آن هم‌خوان نیست." };
  }

  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
  const path = `${entityType.toLowerCase()}/${entityId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("nil-files")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) {
    console.error("uploadAttachment: storage upload failed", upErr);
    return { error: "بارگذاری فایل ناموفق بود." };
  }

  const { error: metaErr } = await supabase.from("attachments").insert({
    entity_type: entityType,
    entity_id: entityId,
    file_name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user.id,
  });
  if (metaErr) {
    await supabase.storage.from("nil-files").remove([path]);
    return { error: persianError(metaErr.message) };
  }

  revalidatePath(`${target.path}/${entityId}`);
  return null;
}

/** Delete an attachment (uploader or admin per RLS/storage policy). */
export async function deleteAttachment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const backTo = String(formData.get("back_to") ?? "/");
  if (!id) return { error: "شناسهٔ پیوست نامعتبر است." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve the trusted storage path from the DB row (never from the client).
  // RLS lets an active user read the metadata; delete is restricted to the
  // uploader or an ADMIN by policy, so an unauthorized caller removes nothing.
  const { data: row, error: loadErr } = await supabase
    .from("attachments")
    .select("id, storage_path")
    .eq("id", id)
    .single();
  if (loadErr || !row) return { error: "پیوست یافت نشد یا دسترسی مجاز نیست." };

  const { data: deleted, error } = await supabase
    .from("attachments")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: persianError(error.message) };
  if (!deleted || deleted.length === 0)
    return { error: "اجازهٔ حذف این پیوست را ندارید." };

  // Remove the stored object using the trusted path from the DB row.
  await supabase.storage.from("nil-files").remove([row.storage_path as string]);

  revalidatePath(backTo);
  return null;
}

/** Form-action wrapper (void return) for inline delete buttons. */
export async function deleteAttachmentForm(formData: FormData): Promise<void> {
  await deleteAttachment(null, formData);
}

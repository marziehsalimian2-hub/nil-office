import { checkSignature } from "@/lib/upload-validation";

/**
 * Telegram attachments are UNTRUSTED input (spec §63/§65): the declared MIME type and the file name are
 * attacker-controlled, so the type is decided from the file's own leading bytes. Only the five types the
 * model can actually read are accepted (PDF, JPEG, PNG, GIF, WebP) — anything else is rejected before a
 * single byte reaches the LLM or storage. Pure (no Supabase / server-only) so it is unit-tested.
 */

export const MAX_TELEGRAM_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export type DetectedAttachment =
  | { ok: true; kind: "image"; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; ext: "jpg" | "png" | "gif" | "webp" }
  | { ok: true; kind: "document"; mediaType: "application/pdf"; ext: "pdf" }
  | { ok: false; error: string };

const CANDIDATES = [
  { ext: "pdf", kind: "document", mediaType: "application/pdf" },
  { ext: "jpg", kind: "image", mediaType: "image/jpeg" },
  { ext: "png", kind: "image", mediaType: "image/png" },
  { ext: "gif", kind: "image", mediaType: "image/gif" },
  { ext: "webp", kind: "image", mediaType: "image/webp" },
] as const;

export function detectTelegramAttachment(bytes: Uint8Array): DetectedAttachment {
  if (bytes.length === 0) return { ok: false, error: "فایل خالی است." };
  if (bytes.length > MAX_TELEGRAM_ATTACHMENT_BYTES) return { ok: false, error: "حجم فایل بیش از حد مجاز است (حداکثر ۱۵ مگابایت)." };
  for (const c of CANDIDATES) {
    if (checkSignature(c.ext, bytes)) return { ok: true, kind: c.kind, mediaType: c.mediaType, ext: c.ext } as DetectedAttachment;
  }
  return { ok: false, error: "فقط تصویر (JPG/PNG/WebP/GIF) یا PDF سالم پذیرفته می‌شود؛ محتوای این فایل با هیچ‌کدام از این قالب‌ها هم‌خوان نیست." };
}

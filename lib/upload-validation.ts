// Canonical upload validation. The file EXTENSION is the authoritative
// gate (never the browser-supplied MIME alone). When the browser also
// sends a MIME type, it must be consistent with the extension; a mismatch
// is rejected (e.g. an .exe renamed to .pdf, or a .pdf sent as image/png).

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// extension -> set of MIME types considered consistent with it.
const EXT_MIME: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  zip: ["application/zip", "application/x-zip-compressed"],
  rar: ["application/vnd.rar", "application/x-rar-compressed", "application/octet-stream"],
};

export function allowedExtensions(): string[] {
  return Object.keys(EXT_MIME);
}

export function extensionOf(fileName: string): string | null {
  const clean = (fileName || "").trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return typeof s === "string" && UUID_RE.test(s.trim());
}

// Extensions whose magic bytes are reliable enough to verify. Container
// formats (docx/xlsx/zip/…) are intentionally not signature-checked here —
// this is a lightweight guard for v1, not an antivirus subsystem.
const SIGNATURE_EXTS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp"]);

export function signatureCheckable(ext: string | null): boolean {
  return !!ext && SIGNATURE_EXTS.has(ext);
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/** Verify a file's leading bytes match the extension (for supported types). */
export function checkSignature(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]); // GIF8
    case "webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && // RIFF
             startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8); // WEBP
    default:
      return true; // not signature-checked
  }
}

export type UploadCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate a file by name, browser MIME and size.
 * - extension must be in the allow-list
 * - if a browser MIME is provided it must match the extension's allowed set
 * - size must be within the limit
 */
export function validateUpload(
  fileName: string,
  mimeType: string | null | undefined,
  size: number,
): UploadCheck {
  if (!fileName || size <= 0) return { ok: false, error: "فایلی انتخاب نشده است." };
  if (size > MAX_UPLOAD_BYTES)
    return { ok: false, error: "حجم فایل بیش از حد مجاز (۲۵ مگابایت) است." };

  const ext = extensionOf(fileName);
  if (!ext || !(ext in EXT_MIME))
    return { ok: false, error: "پسوند فایل مجاز نیست." };

  const mime = (mimeType || "").trim().toLowerCase();
  if (mime && !EXT_MIME[ext].includes(mime))
    return { ok: false, error: "نوع فایل با پسوند آن هم‌خوان نیست." };

  return { ok: true };
}

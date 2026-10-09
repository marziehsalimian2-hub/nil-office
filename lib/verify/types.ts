/** NIL Verify — shared types and labels. Pure (importable from client components). */

export const VERIFY_DOCUMENT_TYPES = ["OUTGOING_CORRESPONDENCE", "PROFORMA", "INVOICE", "CONTRACT", "BOARD_MINUTES"] as const;
export type VerifyDocumentType = (typeof VERIFY_DOCUMENT_TYPES)[number];

export const VERIFY_STATUSES = ["PENDING", "ACTIVE", "REVOKED", "SUPERSEDED"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

export const VERIFY_DOCUMENT_TYPE_LABEL: Record<VerifyDocumentType, string> = {
  OUTGOING_CORRESPONDENCE: "نامهٔ صادره رسمی",
  PROFORMA: "پیش‌فاکتور",
  INVOICE: "فاکتور",
  CONTRACT: "قرارداد",
  BOARD_MINUTES: "صورت‌جلسهٔ هیئت‌مدیره",
};

export const VERIFY_STATUS_LABEL: Record<VerifyStatus, string> = {
  PENDING: "در انتظار صدور",
  ACTIVE: "معتبر",
  REVOKED: "ابطال‌شده",
  SUPERSEDED: "جایگزین‌شده",
};

export type VerifyLayout = {
  page: "FIRST" | "LAST";
  x_mm: number;
  y_mm: number;
  size_mm: number;
  show_label: boolean;
  show_code: boolean;
  label_text: string;
};

export type VerifyConfig = {
  enabled: boolean;
  issuer_name: string;
  public_label: string;
  layout: VerifyLayout | null;
};

/** What a detail page / the PDF routes learn about a document's verification (module-access gated RPC). */
export type VerifyDocumentStatus =
  | { exists: false }
  | {
      exists: true;
      id: string;
      status: VerifyStatus;
      code: string;
      document_number: string;
      activated_at: string | null;
      revoked_at: string | null;
      hash_prefix: string | null;
      pdf_storage_path: string | null;
      verification_count: number;
    };

/** The ONLY shape the public page ever receives (fixed allow-list projection of verify_public_lookup). */
export type PublicVerification =
  | { found: false }
  | {
      found: true;
      status: Exclude<VerifyStatus, "PENDING">;
      document_type: VerifyDocumentType;
      document_number: string;
      issued_at: string;
      issuer: string;
      code: string;
      public_label: string;
      metadata: Record<string, unknown>;
      revoked_at: string | null;
      replacement: { document_number: string; document_type: VerifyDocumentType } | null;
    };

export type HashCheckResult =
  | { found: false }
  | { found: true; invalid: true; match: false }
  | { found: true; match: boolean; status: Exclude<VerifyStatus, "PENDING">; algorithm: string };

export const VERIFY_STORAGE_PREFIX = "verified/";
export const verifiedPdfPath = (verificationId: string) => `${VERIFY_STORAGE_PREFIX}${verificationId}.pdf`;

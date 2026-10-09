import { formatJalali } from "@/lib/jalali";
import { formatExactAmount } from "@/lib/payroll/format";
import { VERIFY_DOCUMENT_TYPE_LABEL, type VerifyDocumentType } from "./types";

/**
 * Public page rows. A SECOND, independent allow-list (the database snapshot is the first): only the keys listed here, per document type,
 * are ever rendered — an unexpected key in a snapshot is silently ignored, never shown. Pure, so it is unit-tested for leakage.
 */
type Fmt = (v: unknown) => string | null;
const text: Fmt = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const date: Fmt = (v) => (typeof v === "string" && v ? formatJalali(v) : null);

type RowSpec = { key: string; label: string; fmt: Fmt };

const SPEC: Record<VerifyDocumentType, RowSpec[]> = {
  OUTGOING_CORRESPONDENCE: [
    { key: "recipient", label: "گیرنده", fmt: text },
    { key: "subject", label: "موضوع", fmt: text },
  ],
  PROFORMA: [
    { key: "customer", label: "مشتری", fmt: text },
    { key: "issue_date", label: "تاریخ صدور سند", fmt: date },
    { key: "valid_until", label: "معتبر تا", fmt: date },
    { key: "total_amount", label: "مبلغ کل", fmt: () => null },   // composed with the currency below
  ],
  INVOICE: [
    { key: "customer", label: "مشتری", fmt: text },
    { key: "issue_date", label: "تاریخ صدور سند", fmt: date },
    { key: "total_amount", label: "مبلغ کل", fmt: () => null },
  ],
  CONTRACT: [
    { key: "counterparty", label: "طرف قرارداد", fmt: text },
    { key: "contract_date", label: "تاریخ قرارداد", fmt: date },
    { key: "total_amount", label: "مبلغ قرارداد", fmt: () => null },   // only present when the admin explicitly allowed it
  ],
  // minimal on purpose (0149): who attended, the agenda, discussion and resolutions are never public
  BOARD_MINUTES: [
    { key: "meeting_date", label: "تاریخ جلسه", fmt: date },
  ],
};

export type PublicRow = { label: string; value: string };

export function publicRows(type: VerifyDocumentType, metadata: Record<string, unknown> | null | undefined): PublicRow[] {
  const md = metadata ?? {};
  const out: PublicRow[] = [];
  for (const spec of SPEC[type] ?? []) {
    if (spec.key === "total_amount") {
      const amount = typeof md.total_amount === "string" ? md.total_amount : null;
      const cur = typeof md.currency === "string" ? md.currency : null;
      const v = amount ? formatExactAmount(amount, cur) : null;
      if (v && v !== "—") out.push({ label: spec.label, value: v });
      continue;
    }
    const v = spec.fmt(md[spec.key]);
    if (v) out.push({ label: spec.label, value: v });
  }
  return out;
}

/** Fixed top-level keys of the public projection (everything else the page could ever receive is dropped). */
export const PUBLIC_PROJECTION_KEYS = [
  "found", "status", "document_type", "document_number", "issued_at", "issuer", "code", "public_label", "metadata", "revoked_at", "replacement",
] as const;

export const publicTypeLabel = (t: VerifyDocumentType) => VERIFY_DOCUMENT_TYPE_LABEL[t] ?? "سند";

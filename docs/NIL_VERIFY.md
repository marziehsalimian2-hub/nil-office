# NIL Verify v1.0 — document authenticity layer

**NIL Verify is not a QR generator.** It is an authenticity layer for immutable, official documents:
the QR identifies a *verification record*, SHA-256 verifies the *exact issued file*, a public disclosure policy controls what a stranger may see, and the
original modules (correspondence, invoices, contracts) stay the source of truth. Security and privacy are deny-by-default.

Supported in v1: **OUTGOING_CORRESPONDENCE** (نامهٔ صادره), **PROFORMA**, **INVOICE**, **CONTRACT** (NIL_ISSUED only). Everything else (payslips, receipts, payment advices,
client service reports, incoming letters, HR / accounting documents, cheques, trade documents) is **out of scope**. The core is generic: a new type needs one gate branch, one
snapshot branch (`_verify_snapshot`) and one config row.

Wording: the system offers «استعلام اصالت سند», «تأیید ثبت سند در NIL Office», «تطبیق فایل با نسخهٔ ثبت‌شده». It is **not** a legal digital signature or an official
electronic-signature certificate (no PKI exists; PKI is deliberately out of v1, but nothing here prevents adding it later).

## Architecture

```
Official document → module's own finalize RPC (number issued)
  → verify_begin   : unguessable token (only its SHA-256 is stored) + code + public metadata SNAPSHOT  → status PENDING
  → render the document PDF with the existing renderer (extra bottom margin so the plate cannot touch content)
  → overlay the QR plate (pdf-lib)                         ← QR is drawn BEFORE hashing: no QR ↔ hash cycle
  → freeze: SHA-256 of THOSE exact bytes → upload privately (verified/<id>.pdf) → verify_activate    → status ACTIVE
  → public page /verify/<token>
```

- **One engine, four adapters.** `lib/verify/issue.ts` is the single implementation; `lib/verify/hooks.ts` gives each module its entry point:
  letters (`archiveLetterPdf`, shared by the web UI and the Assistant), proformas/invoices (`issueSalesDocument` + `issueSalesDocumentCore`), contracts (`approveContract`).
- **Tables** (migration `0143_nil_verify.sql`; RLS on, **no policies**, no browser grants): `document_verifications` (the record), `verification_settings`, `verification_doc_types`
  (QR layout per type), `verification_rate_limits`. A partial unique index allows at most **one PENDING/ACTIVE verification per document**; a trigger freezes the record's identity,
  snapshot and file evidence once it leaves PENDING and forbids deletion.
- **Verification code** `NIL-V-XXXX-XXXX` (ambiguity-free alphabet, unique, collision handled in the database). It is a label, **not** a credential: the public URL uses the 256-bit token
  and there is no lookup by code.
- **QR content** = `<NEXT_PUBLIC_APP_URL>/verify/<43-char token>` and nothing else (no ids, amounts, storage or signed URLs, secrets). The builder refuses a missing/non-https base URL.
- **Public identifier**: 32 random bytes, base64url. Only its SHA-256 is stored, so even a database leak reveals no verification link. It lives only inside the QR printed on the PDF
  (hence an administrator cannot re-derive a link later — by design).

## Lifecycle

| State | Meaning | Public page |
|---|---|---|
| PENDING | identity created, file not yet frozen (a step failed) | not public («سندی با این شناسه قابل تأیید نیست») |
| ACTIVE | hash + stored file registered | ✓ سند معتبر است |
| REVOKED | admin revoked (reason required) **or** the document was cancelled (auto, reason `DOCUMENT_CANCELLED`) | ⚠ این سند ابطال شده است (the page stays — the QR is never dead; the reason is not public) |
| SUPERSEDED | admin marked it replaced by another ACTIVE verification of the same type | ⚠ جایگزین شده + the replacement's number |

A revoked/superseded document is never silently re-verified (`VERIFY_ALREADY_CLOSED`). Revoke, supersede and all settings are **system ADMIN only** (checked in the database), reason required, audited.

**Failure semantics (important):** the official number is issued by the module's own RPC *before* the PDF exists and is never undone. If rendering, hashing or storage fails after that,
the verification stays **PENDING (it can never become ACTIVE without a stored file and a hash)**, the document page shows a red banner and an idempotent **«تلاش مجدد صدور کد استعلام»** button.
Double clicks and concurrent finalizations cannot create two identities (database constraint + advisory lock).

## PDF handling

- The QR plate (white card, QR level M, label + code) is overlaid on the *final page* by default (`LAST`; `FIRST` is configurable per type) at a per-type position/size (mm) — Settings → NIL Verify,
  with a **layout preview** on your real letterhead. It never goes on every page. Defaults sit in the bottom-left footer zone.
- Invoice and contract renderers got one optional parameter (`minBottomMarginMm`); verified documents reserve `plate top + 4 mm` so the plate cannot overlap text, signature or stamp. Letters keep their 48 mm footer.
- After issuance the PDF is **frozen**: `GET /api/{correspondence,invoices,contracts}/[id]/pdf` serves the stored file (never a re-render); a missing frozen file is an error, not a silent re-render.
  `?no_stamp=1` (the print-and-sign variant) is still rendered on demand and carries **no QR** (its bytes cannot match the recorded hash).
- The frozen file is private (`nil-files/verified/<id>.pdf`) and registered as an attachment of the document. Nothing is public; there is no public download.

## Public disclosure policy (DENY BY DEFAULT)

The public metadata is a **snapshot built once at issuance** from an explicit field list (`_verify_snapshot`), so later edits never silently change history; only the *status* is live. The page applies a second allow-list.

| Type | Shown |
|---|---|
| Outgoing letter | issuer, type, number, date, recipient, subject |
| Proforma | issuer, type, number, date, customer, valid-until, currency, total |
| Invoice | issuer, type, number, date, customer, currency, total |
| Contract | issuer, type, number, contract date, counterparty — **amount only if the admin enabled it** (default off; affects new documents only) |

Never shown: internal ids, notes, attachments, follow-ups, audit data, creator, line items, bank/settlement data, internal terms, national ids, phones.

## File check («بررسی فایل PDF»)

The browser computes SHA-256 (Web Crypto) and sends **only the hash** (`POST /api/verify/check`); the file is never uploaded or stored. Result: «✓ فایل دقیقاً با نسخهٔ ثبت‌شده مطابقت دارد» or
«✕ مطابقت ندارد» — a mismatch is *not* called forgery (re-saved, compressed, printed/scanned or edited files all differ). SHA-256 proves exact-binary identity only; a scan or print-to-PDF cannot match.
The algorithm is stored (`pdf_hash_algorithm`) for future migration.

## Security & privacy

- Public endpoints are zero-trust: the token shape is validated before any database call; every request is **rate limited** (page 60/min, file check 20/min per pseudonymous key = SHA-256(IP | UTC day | secret); the IP is never stored;
  the *last* `X-Forwarded-For` entry — the one the proxy appended — is used); every failure is a generic message (no SQL/stack/ids). Public RPCs are granted to **service_role only**.
- Issuance RPCs are gated by the **same permission as the module's own finalize** (`is_active_user` for letters, `can_approve_invoice`, `can_approve_contract`) *and* by a real finalized state; ordinary users cannot create a verification for an arbitrary document.
  Residual risk: a user who may finalize could call `verify_activate` with a hash of his choice — the database can only check shape and path, not the file contents.
- Audit (`write_log`): created, activated, hash registered, revoked, superseded, settings/layout changed. Public lookups only increment `verification_count` / `last_verified_at` (no personal data).
- Factory Reset integration: `document_verifications` + `verification_rate_limits` are DELETE (operational), `verification_settings` + `verification_doc_types` PRESERVE, storage prefix `verified/` is DELETE and registered verified paths are known to the classifier.

## Operations

- Needs migration `0143`, deployed code, and `NEXT_PUBLIC_APP_URL` = the public https origin (it is baked into the QR). Packages added: `qrcode` (runtime), `jsqr` + `@types/qrcode` (tests).
- Turn it off globally or per type in Settings → NIL Verify; existing verified documents keep working.
- **No backfill:** documents finalized before NIL Verify are not verified and never will be silently. A separate, explicit workflow would be needed for verified historical issuance.

## Limitations (v1)

- Numbering precedes the PDF → PENDING + retry rather than rollback.
- The public link exists only inside the PDF; the database cannot reproduce it.
- No Assistant action (the LLM must never assert authenticity — the verification engine is the only source of truth).
- Scanned/printed copies cannot be matched by hash; they can only be checked through the page's status data.
- No PKI/digital signature; no per-page QR; no public download; no analytics beyond `verification_count`.

## Future extension

Payslip, official receipt, payment advice, client service report, employment certificate: add the type to the two CHECK lists, a gate branch in `_verify_require_issuer/_reader`, a snapshot branch, a config row and a call site;
no engine rewrite. PKI could later sign the same frozen bytes and record the signature next to the hash.

## Tests

`lib/verify/*.test.ts` (run by `npx vitest run`): token entropy, URL/QR content, **QR decoded from a raster of real stamped PDFs**, hash match / one-bit-flip mismatch, layout geometry, public-projection leakage, migration guards.
`lib/verify/pdf.test.ts` renders the real letter / proforma / invoice / multi-page contract with Chromium (≈2 min). Hand-run SQL: `supabase/tests/nil_verify_integrity.sql` (rolled back).

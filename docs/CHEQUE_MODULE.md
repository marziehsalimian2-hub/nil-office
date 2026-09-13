# Cheque Management v1.0

## Architecture

Cheque Management is **not** an independent chequebook — it is a thin layer on top of the existing NIL Office domains:

- **Bank accounts**: a cheque book references `bank_accounts` (0007) — never duplicates bank/branch/account-number columns.
- **Companies**: `counterparty_company_id` is an optional FK, with `counterparty_name_snapshot` copied server-side at draft creation (same pattern `sales_documents.customer_legal_name_snapshot` uses) — a later company rename never rewrites cheque history.
- **Attachments**: reuses the existing generic `attachments` table/`nil-files` bucket (`'CHEQUE'` added to `attach_entity`). No new storage.
- **Audit**: every status-changing RPC calls `write_log()` with a semantic action name, on top of the generic `tg_audit` trigger already on `cheques`/`cheque_books`.
- **Accounting**: see "Accounting relationship" below — this is the one hard architectural rule of the module.
- **NIL Assistant / Attention Engine**: see "Assistant readiness" below.

## Two directions, one table

`cheques.direction` is `PAYABLE` (a cheque NIL Office writes and prints from its own `cheque_books`) or `RECEIVABLE` (a cheque received from another company, recorded and deposited, never printed by us). This was added beyond the original spec text (which was written PAYABLE-only) after explicit confirmation with the user that both directions must be supported in v1.

- `cheque_book_id` is required for PAYABLE, null for RECEIVABLE.
- `drawer_bank_name`/`drawer_branch`/`drawer_account_number` are required for RECEIVABLE (there is no `cheque_books` row for another company's chequebook), null for PAYABLE.
- Cheque-number uniqueness is direction-scoped: `(cheque_book_id, cheque_number)` for PAYABLE, `(drawer_bank_name, drawer_account_number, cheque_number)` for RECEIVABLE.

## Statuses

```
PAYABLE:    DRAFT → PREPARED → ISSUED → DELIVERED → CLEARED
                              ↘ RETURNED   ↘ VOID   ↘ CANCELLED (pre-ISSUED only)
RECEIVABLE: DRAFT → RECEIVED → DEPOSITED → CLEARED
                                         ↘ RETURNED
```

Valid transitions live in `cheque_status_transitions` (a plain reference table, direction + from + to), looked up by every transition RPC — never enforced by a CHECK constraint (which can't see the OLD row) or a generic trigger (which can't express per-transition role gates cleanly).

**No silent modification** (once a cheque leaves DRAFT): RLS blocks a plain `UPDATE` from touching `status` at all outside DRAFT, and a separate `tg_cheques_immutability` trigger blocks `amount`/`counterparty_company_id`/`counterparty_name_snapshot`/`cheque_date`/`cheque_number` from changing via **any** path, including the RPCs themselves. A mistake after DRAFT means VOID (PAYABLE, a ruined/misprinted leaf, number never reused) or CANCEL (either direction, the process itself called off) — never an edit.

**VOID vs. CANCELLED**: VOID = a physical PAYABLE leaf is unusable (misprinted, damaged) — the leaf's number is permanently burned. CANCELLED = the issuance/recording process was called off before it went that far (pre-ISSUED for PAYABLE, pre-DEPOSITED for RECEIVABLE) — no physical leaf was spoiled.

## Accounting relationship

**Cheque creation/printing never posts a journal entry.** The only accounting-integration point is `clear_cheque()`, at the **CLEARED** status (confirmed with the user — not ISSUED, since funds haven't actually moved until then): it inserts exactly one `DRAFT` row into `payments` (PAYABLE, `method='CHEQUE'`) or `receipts` (RECEIVABLE, `method='CHEQUE'`), copying amount/currency/counterparty/date, and links it back via `cheques.payment_id`/`receipt_id`. It never calls `post_journal_entry` and never touches `journal_entries`. This mirrors `create_accounting_draft_from_sales_document` (0063) exactly: if the DRAFT row is never posted by a human accountant, nothing else happens — it sits in Accounting's own unposted queue like any manually-entered draft.

## Permissions

A single 4-tier `cheque_role` enum (`VIEW/CREATE/APPROVE/ADMIN`), matching every other financial/permission-bearing domain in this codebase (`accounting_role`, `contract_role`, `invoice_role`, `crm_role`, `project_role`, `trade_role`) — not the spec's literal 8 named permissions, which were reconciled onto this enum (confirmed with the user):

| Action | Tier |
|---|---|
| View | VIEW+ |
| Create/edit draft, prepare, print (pre-ISSUED) | CREATE+ |
| Reprint an ISSUED+ cheque | APPROVE+ (checked at runtime inside `record_cheque_print`) |
| Issue, deliver, receive→deposit, clear, return | APPROVE+ |
| Void, cheque-book/template administration | ADMIN |

## Assistant readiness

`lib/assistant/actions/cheque.ts` registers: `SEARCH_CHEQUES`, `GET_CHEQUE`, `GET_CHEQUES_DUE`, `GET_CHEQUE_BOOK_STATUS` (read-only), and two MEDIUM write-proposals requiring confirmation: `CREATE_CHEQUE_DRAFT` and `PREPARE_CHEQUE_PRINT`. There is **no** `ISSUE_CHEQUE`/`PRINT_CHEQUE`/`CLEAR_CHEQUE` tool at all — per spec §42, real issuance/printing from the Assistant is out of scope for v1, enforced by the tool simply not existing (the same technique this codebase's Action Registry already uses to keep Trade Portal publish/buyer-issuance out of the Assistant's reach). Both surfaces (web chat and Telegram) get these automatically since they share the same `runChatTurn`/Action Registry.

Attention Engine (`lib/dashboard/attention.ts`) gained one more gated block: `CHEQUE_DUE_TODAY`/`CHEQUE_DUE_SOON`/`CHEQUE_OVERDUE`/`CHEQUE_RETURNED`, reusing the existing `getAttentionItems` function — no parallel engine.

## Known limitations (v1)

- **No blank-leaf inventory**: `cheque_books.first_cheque_number`/`last_cheque_number`/`leaves_count` are informational metadata; the `AVAILABLE` status exists in the enum for spec-literal completeness but is never actually assigned (a cheque row is created directly at DRAFT). A future version could pre-populate one `AVAILABLE` row per leaf if physical-leaf tracking becomes necessary.
- **Generic `company_id`/`case_id`/`project_id`/`sales_document_id` links** exist in the schema and RPCs but the web "new cheque" form only exposes `contract_id` and the counterparty company for v1 — the others are reachable via `update_cheque_draft` or future UI work, not yet a form field.
- **No incoming-cheque exchange-rate handling**: `currency_code` is a label only; a non-IRR/TOMAN cheque linked to a document in a different currency has no automatic conversion (matches how `sales_documents.currency_code` behaves today).
- **Telegram cheque creation** is architecturally ready (same Action Registry) but not implemented in this module — per spec §41, only read queries ("what cheques are due next week") are expected to work through Telegram once the Telegram channel calls these same actions; no Telegram-specific code was added here.
- **`security-rls-cheque.mjs`/`cheque_integrity.sql`** are written and reviewed but **NOT RUN** in this session (no live Supabase project reachable in this sandbox) — run them by hand against a staging project per their own header instructions.

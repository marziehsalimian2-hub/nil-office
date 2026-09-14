# Accounting AI Safety

**No accounting action exists in the NIL Assistant Action Registry, in any form, on any channel, as of this document (Phase 1 of the Multimodal Telegram v2.0 work).** This is not an oversight — it is the one categorical exclusion that Phase 1's otherwise-deliberate widening of the registry to HIGH-risk actions (see `NIL_ASSISTANT_MULTIMODAL.md`) does **not** touch.

## The rule

> AI (voice, text, photo, or PDF) never posts a journal entry. Not now, not with confirmation, not ever, until a future module explicitly implements an accounting-draft flow — and even then, posting itself stays a separate, human-only, existing-authorization step.

This mirrors the rule Cheque Management already established (`docs/CHEQUE_MODULE.md`) and the invoice engine's own `create_accounting_draft_from_sales_document` (0063) precedent: an AI-adjacent flow may create a `DRAFT` row in `payments`/`receipts`/`journal_entries` — never call `post_journal_entry`/`post_payment`/`post_receipt` itself. Posting requires `can_post_accounting()` (a human, through the existing web UI's own posting action), completely outside anything the Assistant registry can reach.

## Why this document exists now, before any accounting action is built

Spec §124's security gate asks explicitly: *"آیا عکس فاکتور می‌تواند سند حسابداری را Auto-Post کند؟"* — the answer must be **NO**, verifiably, at every point in this project's life, not just the point some accounting feature ships. Writing this rule down now, while the registry has zero accounting actions, makes the invariant checkable by inspection (`grep -r "accounts\|journal_entries\|payments\|receipts" lib/assistant/actions/` should return nothing touching these tables) rather than something a future module could quietly violate by not knowing the rule exists.

## When an accounting-draft feature (spec §22-31) is eventually built

- Reuse `createPayment`/`postPayment`'s existing DRAFT-then-post separation (`app/actions/accounting.ts`, confirmed this session) — never a new journal-entry writer.
- A LOW-confidence extraction (photo/PDF/voice) must never reach even the DRAFT-creation step without an explicit human confirmation showing the extracted fields — matches spec §28's confidence-tiering.
- A missing payment source (which bank/cash account) must be asked for, never guessed (spec §29).
- Duplicate detection (file hash + vendor + invoice number + date + amount, spec §31) must run before any DRAFT is created, not after.
- The account-suggestion lookup against the Chart of Accounts (`accounts`/`bank_accounts`) has no existing search helper (confirmed this session — only plain unfiltered `select` calls exist today) — this needs to be built fresh, not assumed to already exist.

None of the above is implemented yet. This document exists to make the boundary explicit while it's still trivially true, not to describe a built feature.

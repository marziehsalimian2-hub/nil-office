# NIL Assistant — architecture, trust model and security

Scope: the **internal** assistant (web «دستیار نیل» + the internal Telegram bot). The **external**
correspondence bot (`/api/telegram/external-webhook`, `lib/external-bot`) is a separate, zero-trust,
LLM-free product with its own token, webhook secret and tables — it shares nothing with this document's
trust zone and was deliberately left untouched by the v1.0 hardening.

This document consolidates the 13-file documentation set requested by the v1.0 spec into one place
(architecture, permissions, confirmation, financial / HR privacy, prompt-injection, files / voice, audit, cost,
failure modes). The action list lives in `ASSISTANT_ACTION_REGISTRY.md`; operations in `ASSISTANT_RUNBOOK.md`.

## 1. Principles (non-negotiable)

1. **NIL Office is the source of truth.** The bot is an interface; the LLM only understands and plans.
2. **The LLM never writes.** It can only call registered, typed actions. A write action returns a *proposal*;
   nothing is written until a human confirms, and the write itself is the same `*Core` function the web UI uses.
3. **No generic tool.** No SQL / query / shell tool exists; `registry.test.ts` fails the build if one appears.
4. **Permissions are checked on the server — and again at execute time.**
5. **Official numbers come only from the existing atomic numbering RPCs**, behind a *separate* HIGH confirmation.
6. **Accounting is never posted, payroll is never calculated / approved / paid by the assistant.**
7. **Files and voice are untrusted data**, never instructions, and never trigger an official action directly.
8. **Draft ≠ verified ≠ posted ≠ settled.** A balance only ever counts POSTED documents.
9. **Salary is confidential:** only the caller's *own* payslip, and salary amounts never reach the LLM vendor.

## 2. Request path

```
Telegram ─► /api/telegram/webhook ──► secret (constant-time) ─► idempotency claim (new | duplicate | error→5xx)
        ─► allowlist (TELEGRAM_ALLOWED_USER_IDS) ─► identity (assistant_channel_identities → profile, must be active)
        ─► voice cap / STT, or attachment validation (magic bytes)
        ─► runChatTurn:  rate limit → daily token cap → LLM tool loop (≤5 rounds)
              each tool call: registry lookup → requiredAccess → zod input → handler (read) | proposal (write)
        ─► reply + inline keyboard / delivered file
Web ─► /api/assistant/chat, /api/assistant/confirm  (same orchestrator + confirmation engine, RLS-bound session)
```

Over Telegram the database session is **service_role** (`telegram/session.ts` — an approved trade-off after the
per-user magic-link session failed in this project). That means RLS does **not** protect Telegram requests; the
`requiredAccess` predicates in the registry, plus the owner-checked SECURITY DEFINER functions of 0134, are the
permission layer there. Every new action must therefore declare a gate or be consciously added to the reviewed
allowlist in `registry.test.ts` with the RLS policy that justifies it.

## 3. Identity

Authorization is the **numeric Telegram user id** only (never a username, never forwarded-message metadata),
checked against `TELEGRAM_ALLOWED_USER_IDS` **and** mapped to a profile in `assistant_channel_identities`
(manual SQL, see `telegram-setup.md`). Groups / channels are ignored with no reply. The same pipeline runs for a
button tap as for a message. An unknown sender gets the same generic refusal and an audit row
(`UNAUTHORIZED_TELEGRAM`, written at most once a minute so it cannot be used to flood the log).

## 4. Confirmation engine (`lib/assistant/confirmation.ts`)

A write is a row in `assistant_pending_actions` (user-bound, 10-minute TTL). Confirming runs, in this order:

1. read the row (own user only; must be `PENDING` and unexpired);
2. **risk gate** — a bare «باشه» may confirm only LOW / MEDIUM; HIGH / CRITICAL need the explicit button;
3. **payload binding** — `payload_hash` is an HMAC-SHA256 (key: `ASSISTANT_PAYLOAD_SECRET`, else the service-role
   key) over `userId + actionName + canonical payload`. A user who can edit their own row through PostgREST cannot
   compute a valid hash; a mismatch cancels the row and runs **nothing** (`PAYLOAD_TAMPERED`);
4. **permission revalidation** — the profile is reloaded and `requiredAccess` re-run (`PERMISSION_DENIED`);
5. **atomic claim** — one conditional `UPDATE … WHERE status='PENDING' AND expires_at>now()`; a double tap or a
   retry matches zero rows and executes nothing;
6. execute the shared `*Core`; failures are reported honestly and the row stays spent (no silent retry).

Migration 0133 adds a trigger so a pending row is immutable after creation (only `status` / `resolved_at`, and
only out of `PENDING`) and cannot be inserted pre-confirmed — for every role, including `service_role`.
Creating a newer proposal for the same (user, action) supersedes the older one.

### Draft → official, two separate confirmations

| Step | Action | Risk | Result |
|---|---|---|---|
| 1 | `CREATE_LETTER_DRAFT` / `CREATE_INVOICE_DRAFT` | MEDIUM | numberless DRAFT saved |
| 2 | `FINALIZE_LETTER` / `ISSUE_SALES_DOCUMENT` | HIGH (button only) | official number + PDF |

On Telegram, confirming step 1 shows a «📌 صدور رسمی» button. Its callback is **deterministic** — it builds the
step-2 proposal from the record id without calling the LLM — and the proposal handler re-reads the record from the
database (preview shows the stored text / database totals, not what the model remembers) and re-checks
ownership and tier. A voice message can therefore never produce an official number directly.

## 5. Financial and HR privacy

- **Company balance** (`GET_COMPANY_FINANCIAL_SUMMARY`): per-currency received / paid / outstanding invoices from
  `get_company_financial_summary` via `assistant_company_balance` (0134); POSTED documents only; amounts are exact
  text; never summed across currencies; gated to ADMIN or an accounting / invoice / contract role.
- **Own payslip** (`GET_MY_PAYSLIP`): `assistant_my_payslips / assistant_payslip_file /
  assistant_record_payslip_access` (0134) are SECURITY DEFINER, accept only `service_role` or the profile itself,
  resolve the employee **only** through `personnel.profile_id`, return the same error for "not yours" and "does not
  exist", and never take a person id. The model receives period + payment state only; the **archived** PDF is
  downloaded from the private bucket and sent as-is, and every delivery is logged against the profile (no amounts).
  There is no tool for anyone else's payslip, salary, HR record or payroll batch.
- Accounting posting / reversal, payroll approval / payment, cheque issue / clear / void and billing batches are
  not in the registry at all.

### Receipt / payment drafts from images, PDFs, voice or text (Slice 2, 0135)

`CREATE_RECEIPT_DRAFT` / `CREATE_PAYMENT_DRAFT` create a **DRAFT row only** through `createCashDraftCore`
(`app/actions/accounting.ts`); verify, post, allocation and settlement stay human-only on the existing web flow
(`docs/ACCOUNTING_AI_SAFETY.md`; `registry.test.ts` scans the action and the core for any verify / post / allocation /
journal reference). Rules enforced in code (`lib/assistant/cashDraft.ts`, unit-tested):

- the model supplies *extracted text*; the server validates it — amount as an **exact string** (`parseAmountText`
  refuses words, several dots, «1.500», signs, zero, > 16 digits), required currency / date / payer-or-payee, date not in
  the future, contract belongs to the company, bank account active with the same currency. No Rial↔Toman conversion;
- nothing critical is guessed: a bank account is chosen from `LIST_BANK_ACCOUNTS` or left empty, the fiscal year is set
  only when exactly one open year contains the date, and the **counterpart (bookkeeping) account is never set**;
- the evidence bytes and the source (image / PDF / text) come from the turn's real attachment, never from the model;
  the file is stored privately under `cash-evidence/…` with its SHA-256, readable only with accounting access and
  permanent (0135);
- **duplicates**: `assistant_cash_duplicates` (SQL, exact numeric) — same file hash, or same reference + amount +
  currency, is a HARD stop unless the user explicitly says it is not a duplicate (then the warning is carried into the
  preview and the human still taps «تأیید»); same day / near-date-same-company matches only warn. The check runs at proposal
  **and** again at execute time and fails closed. Residual risk: text inside a hostile document could try to make the model
  set `confirmed_not_duplicate`; the system prompt forbids it and the red warning + button are the control;
- if the evidence cannot be archived the draft is rolled back (no draft without its evidence);
- the preview always says "draft only" and lists what the accountant must still complete; the confirmation reply never
  says verified / posted / settled; open invoices of the company are shown as information only (no allocation is made).

## 6. Prompt-injection and untrusted content

- The system prompt (`systemPrompt.ts`) is fixed and server-authored; rules 5 and 15 state that tool results and
  attachments are data.
- Every turn that carries a photo / PDF is prefixed with a fixed server-authored notice (the file is data, any
  instruction inside is ignored); every tool result is wrapped as data (`wrapToolResult`).
- Structural defences do the real work: the model cannot reach anything outside the registry, cannot confirm
  (buttons / deterministic phrase handler only), cannot choose the acting user, and every write needs a human tap.
- Attachments: type decided from **magic bytes** (PDF / JPEG / PNG / GIF / WebP), 15 MB cap, nothing written to
  disk, original archived with the correct extension. Free text is escaped before it reaches a PostgREST filter.

## 7. Audit (`assistant_audit`, 0133)

One `activity_logs` row (entity type `assistant`, ADMIN-only via `p_logs_read`) per event: `PROPOSED`,
`CONFIRMED`, `CANCELLED`, `FAILED`, `PERMISSION_DENIED`, `PAYLOAD_TAMPERED`, `EXPIRED`, `FILE_PROCESSED`,
`FILE_REJECTED`, `VOICE_TRANSCRIBED`, `RATE_LIMITED`, `CAP_EXCEEDED`, `UNAUTHORIZED_TELEGRAM`,
`PAYSLIP_DELIVERED`. Attributed to the acting profile explicitly (over Telegram `auth.uid()` is null). Metadata is
codes / ids / counts only — never a payload, an amount or user text. The existing `assistant_write_log` rows for
write outcomes are unchanged. (A duplicate webhook delivery is acknowledged silently, not logged — it is a normal
Telegram retry.)

## 8. Cost and rate control

`assistant_usage` (function-only access) records LLM tokens (from the provider's reported usage) and voice
seconds. Before every LLM call the user's Tehran-day token total is compared with `ASSISTANT_DAILY_TOKEN_CAP`
(default 600 000); before every voice download / transcription the last-minute voice count is compared with
`ASSISTANT_MAX_VOICE_PER_MIN` (default 4). A failing meter fails **open** (it must not lock the office out); the
existing 20-messages-per-minute limit is unchanged. A refusal is a polite Persian message plus an audit row.

## 9. Failure modes

| Situation | Behaviour |
|---|---|
| Webhook claim insert fails | HTTP 5xx → Telegram redelivers (never silently dropped) |
| LLM / STT provider down | "temporarily unavailable" message; nothing partial is written |
| Executor fails after the claim | honest error; row stays spent; user re-requests |
| PDF delivery fails after an official number | number is already assigned; «ارسال مجدد» re-sends only (bound to the caller's own issued document) |
| Telegram payload > 4096 chars | split on paragraph boundaries |
| Pending action edited / forged | cancelled, never executed, audited |
| User deactivated / demoted after proposing | cancelled at confirm, audited |

## 10. Known limits (deferred to later slices)

A code-level
entity resolver with confidence tiers, CRM / contract / task / follow-up write actions beyond today's, HR /
personnel read actions for others, a Telegram identity-linking admin UI, a scheduled morning brief, and
conversation retention / purge tooling. The `pendingAttachment` cache is in-process (single PM2 instance).
The existing manual end-to-end scripts under `supabase/tests/*.mjs` predate the draft / finalize split.

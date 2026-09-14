# NIL Assistant — Multimodal Telegram v2.0

## Phase 1 — voice letters/invoices

Voice-and-text-driven **letter drafting/finalization** and **invoice/proforma drafting/issuance** on the **existing** internal Telegram bot (Marzieh/Saman only). Shipped and live-confirmed 2026-09-14.

## Phase 2 — incoming letters + reply/follow-up

Photo/PDF-driven **incoming letter registration**, with the bot proposing a follow-up or a linked reply based on what it extracted. Still deferred: external correspondence bot, expense-receipt/accounting-draft extraction, Smart Inbox classification layer.

## Architecture

```
Telegram voice note
  → getFileDownloadUrl + fetch (in-memory, never disk)
  → SpeechToTextProvider.transcribe()  [lib/assistant/speech/]
  → transcript echoed back ("🎙 شنیدم: ...")
  → plain text from here on — the EXACT same runChatTurn() the text path uses
  → Action Registry → Confirmation Engine → existing Correspondence/Invoice services → Database
```

No new orchestrator logic, no new Telegram-specific business logic — voice becomes text at the transcription boundary and everything downstream is the code that already existed for the text-only Assistant.

## Speech-to-Text

`lib/assistant/speech/` mirrors `lib/assistant/llm/`'s provider-factory shape exactly:
- `provider.ts` — the `SpeechToTextProvider` interface.
- `confidence.ts` — pure, dependency-free confidence heuristic (`classifyConfidence`), kept separate from `openaiWhisper.ts` specifically so it stays unit-testable without a `"server-only"` import chain (see `supabase/tests/whisper-confidence.test.mjs`).
- `openaiWhisper.ts` — the only implementation today, plain `fetch` multipart to OpenAI's `/v1/audio/transcriptions` (`whisper-1`, `response_format: "verbose_json"`, `language: "fa"`).
- `index.ts` — `getSpeechToTextProvider()` factory (`STT_PROVIDER` env, default `openai-whisper`).

**Setup**: set `OPENAI_API_KEY` and `STT_PROVIDER=openai-whisper` in `.env.local`. No code change needed to swap providers later — write a new file implementing `SpeechToTextProvider` and point `STT_PROVIDER` at it.

**Confidence**: Whisper's plain API has no word-level confidence; `verbose_json`'s per-segment `avg_logprob`/`no_speech_prob`, averaged, is the closest proxy. `LOW` confidence adds a correction prompt to the transcript-preview message — it never blocks the message from being processed (the user can just reply with a correction in normal conversation).

**Limits**: voice notes over 15MB or 300 seconds are rejected before download, with a plain Persian message.

## HIGH-risk actions: a deliberate exception

The base Assistant's registry banner (`lib/assistant/actions/registry.ts`) historically excluded every HIGH/CRITICAL action entirely — "no tool definition the model could ever call, not even one guarded by confirmation." This spec (§71/§72) explicitly asks for HIGH-risk actions now: official letter numbering and official invoice/proforma issuance. Two new actions cross that line, each still gated by the exact same Confirmation Engine every MEDIUM action already uses (preview → explicit tap on "تأیید" → atomic claim → executor):

- **`CREATE_LETTER_DRAFT`** — the model composes the full letter body itself as a tool parameter; on confirmation, `createAndFinalizeLetterCore` (`app/actions/correspondence.ts`) drafts, calls the existing `finalize_correspondence` RPC, generates/archives the PDF (`archiveLetterPdf`, shared with the web UI's `finalizeOutgoing`), and returns the official `display_number`.
- **`CREATE_INVOICE_DRAFT`** — the model supplies raw line items only (quantity/price/discount/tax), never a total; `createAndIssueInvoiceCore` (`app/actions/invoices.ts`) drafts the `sales_documents`+`sales_document_items` rows, transitions status through the exact same steps the web UI's own buttons use (`DRAFT→REVIEW→APPROVED`), and calls the existing `finalize_sales_document` RPC. All arithmetic is Postgres generated columns / the existing rollup trigger — this code never computes a total.

CRITICAL (accounting auto-post) remains categorically excluded — see `ACCOUNTING_AI_SAFETY.md`.

## PDF delivery + retry-safety

After a successful `CREATE_LETTER_DRAFT`/`CREATE_INVOICE_DRAFT` confirmation, `handleCallbackQuery` (`lib/assistant/telegram/handleUpdate.ts`) fetches the finalized record's PDF and sends it via a new `sendDocument` wrapper (`lib/assistant/telegram/bot.ts`, multipart `POST` using Node's global `FormData`/`Blob`). This is layered **on top of** the channel-agnostic `confirmPendingAction` — numbering already succeeded and is safe by the time this runs; only the Telegram file-send can fail independently.

If `sendDocument` fails, the bot replies with the official number and an inline **"ارسال مجدد فایل"** button (`callback_data: "resend:<LETTER|INVOICE>:<id>"`). The resend path is a pure read + regenerate + re-send — it never touches the Confirmation Engine, so it structurally cannot create a duplicate record or number.

## Phase 2 architecture

### Vision/PDF support (`lib/assistant/llm/`)

`LlmContentBlock` (`provider.ts`) gained `image`/`document` variants. `AnthropicProvider.toAnthropicMessages` (`anthropic.ts`) maps them to Anthropic's base64 content-block wire format. **Important**: the installed `@anthropic-ai/sdk@0.32.1` has no typed `DocumentBlockParam` (PDF support was added in a later SDK release) — the PDF block is hand-typed against Anthropic's own documented PDF-support format and sent via a type cast, not a real SDK type. This works because the SDK's TS types are compile-time only; what's actually sent over HTTPS is plain JSON — but this specific path (PDF via `msg.document`) needs **live verification** before being trusted, unlike everything else in this document which was confirmed working on the deployed bot. If a future SDK bump adds real `DocumentBlockParam` support, this local interface in `anthropic.ts` can be deleted in favor of the SDK's own type.

An attachment is scoped to the single turn it arrives in — `runChatTurn` takes an optional `attachment` param, appended to the current turn's message content, never persisted to `assistant_messages` (which still stores only the caption/placeholder text) and never replayed into later turns' history.

### Telegram photo/document handling (`lib/assistant/telegram/handleUpdate.ts`)

`msg.photo` (largest `PhotoSize`, always JPEG) and `msg.document` (PDF or image only, everything else rejected before download) are downloaded entirely in-memory and base64-encoded, same in-memory-only discipline as voice. The caption (if any) becomes the turn's text; otherwise a default "check this image/document" prompt is used.

### `REGISTER_INCOMING_LETTER` (`lib/assistant/actions/correspondence.ts`)

HIGH-risk, same shape as `CREATE_LETTER_DRAFT`: one confirmation drafts + calls the existing `register_incoming` RPC + archives the original file as an attachment (`createAndRegisterIncomingCore`, `app/actions/correspondence.ts`). The original file's bytes reach the executor via a new `ActionContext.turnAttachment` field (`lib/assistant/actions/types.ts`), populated by `runChatTurn` from its own `attachment` parameter — **not** as a model-supplied tool parameter (a vision model can describe an image, it can't reproduce its raw bytes as text output). The base64 bytes travel inside the write-proposal's `payload` (stored in `assistant_pending_actions.payload`, a jsonb column with no practical size issue for a single letter-sized file), so they survive from "propose" to "confirm" even though those are separate requests, possibly minutes apart.

### Reply/follow-up — extends existing actions, no new mechanism

- `CREATE_LETTER_DRAFT` gained an optional `reply_to_correspondence_id` — when set, `createAndFinalizeLetterCore` inserts one `correspondence_links` row (`REPLY_TO`) after finalizing, exactly mirroring the web UI's own `createReplyDraft`.
- `CREATE_FOLLOWUP_DRAFT` gained an optional `correspondence_id` — the column and the underlying `insertFollowupDraftCore` already supported it; only the tool's input schema needed it exposed.
- The "does this letter need a reply/follow-up?" classification is **conversational only** (system prompt rule 11), never a stored column or an automatically-triggered action — matches the spec's explicit "this is a suggestion, not authority."

## Known limitations / deferred

- No accounting-draft-from-voice/photo (expense receipts).
- No external Telegram bot.
- No Smart Inbox classification layer across channels.

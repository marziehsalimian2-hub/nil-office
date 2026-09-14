# NIL Assistant — Multimodal Telegram v2.0, Phase 1

Phase 1 of the "NIL Assistant Multimodal & Smart Office Operations v2.0" spec: voice-and-text-driven **letter drafting/finalization** and **invoice/proforma drafting/issuance** on the **existing** internal Telegram bot (Marzieh/Saman only). See §6 of the approved plan for what's explicitly deferred (external correspondence bot, photo/PDF OCR, accounting-from-receipt, incoming-letter/reply/follow-up threading, Smart Inbox).

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

## Known limitations / deferred (see the approved plan for the full list)

- No photo/PDF/OCR intake — `LlmContentBlock`/`AnthropicProvider` have no image/document content-block variant yet.
- No accounting-draft-from-voice/photo.
- No incoming-letter registration, reply drafting, or follow-up suggestion from Telegram yet — the underlying `correspondence_links`/`REPLY_TO` mechanism and `followups.correspondence_id` column already support it whenever it's built.
- No external Telegram bot.

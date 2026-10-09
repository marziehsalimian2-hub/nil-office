# Board Secretariat (دبیرخانهٔ هیئت‌مدیره) — Phase 1

Meetings, minutes and resolutions of NIL's board of directors, built inside NIL Office (decision 2026-10-09) from the rules of the
ACTA v0.1 prototype (Python/SQLite, reviewed, **not** reused as code). Menu: **هیئت‌مدیره** → `/board`.

## Decisions (user, 2026-10-09)

- For NIL now; may be sold later → a clean `board_*` module boundary (tables, `lib/board`, `app/(app)/board`, `app/actions/board.ts`).
- Two board members are **external**: they are `board_members` rows, never NIL Office accounts (an internal member may be linked to a profile).
- The secretary (the user) is the **only system approver**. The other members **sign the printed PDF by hand**; system approval is not a signature.
- Meeting numbers are **continuous** (never reset per year) and issued **at approval** — a deleted draft never leaves a gap.
- The PDF follows the NIL board-minutes Word template (8 numbered sections, navy `#142B48` / gold `#9C793C`), more polished.
- Kept from ACTA: AI (Phase 3) may only draft; it never approves, never invents an owner or a deadline, never closes a resolution.

## Workflow

1. **اعضا و تنظیمات** — add members (internal / external, title, order). Optionally set the last paper meeting number so the series continues.
2. **جلسهٔ جدید** — date + time (Tehran) + place → DRAFT.
3. Draft editor: details (actual start/end, chair, secretary, invitees, intro), roll call, agenda items each with their discussion,
   resolutions (action ones need owner + deadline; a vote note is optional). «پیش‌نمایش PDF» shows the watermarked draft at any time.
4. **تأیید نهایی** (APPROVE tier, explicit confirmation): `board_approve_meeting` checks completeness, issues the meeting number and the
   resolution numbers `<meeting>-<n>` in agenda order, optionally creates the next meeting as a DRAFT (UI proposes +14 days), stores the
   full snapshot and locks everything. Then NIL Verify freezes the QR PDF (best effort — a failure leaves it PENDING with a retry button).
5. Print the PDF; present members sign; Phase 2 will add uploading the signed scan.

Approval refuses (Persian messages in `lib/enums.ts`): missing actual times / chair / secretary, no agenda, no discussion at all, any active
member without a roll-call row, chair or secretary not PRESENT, an action deadline before the meeting day (Tehran). Quorum (more than half
present) is shown but **not enforced**.

## Data model (migrations 0144–0149)

| Table | Notes |
|---|---|
| `board_settings` | single row: `last_manual_meeting_number`, `default_location` (PRESERVED by a factory reset) |
| `board_members` | `kind` INTERNAL/EXTERNAL, optional `profile_id` (never for EXTERNAL), `is_active`, `sort_order`; a member used in a meeting cannot be deleted |
| `board_meetings` | DRAFT → APPROVED only via the RPC; `meeting_number`, `snapshot` (jsonb), `approved_by/at`, `next_meeting_id` |
| `board_agenda_items` | position, title, discussion |
| `board_attendance` | PRESENT / ABSENT / EXCUSED + note, one row per member |
| `board_resolutions` | text, `requires_action`, owner, due date, expected output, vote note, `follow_status` (Phase 2), `resolution_number` |
| `board_audit_log` | append-only; field NAMES of every change + semantic events; readable only with board access |

**Locks (triggers, effective even for the table owner):** approval fields only through the RPC (flag `nil.board_approve`); an APPROVED
meeting and its agenda / attendance / resolutions can never change — except `board_resolutions.follow_status` (Phase 2 follow-up) and the
FK reset of `next_meeting_id` when that suggested draft is deleted. The PDF of an approved meeting is always rendered from the snapshot, so
later follow-up progress never alters the minutes.

**Permissions:** `profiles.board_role` VIEW / CREATE / APPROVE / ADMIN (Settings → کاربران → «دسترسی هیئت‌مدیره»); global ADMIN passes all.
Separate from every other role (board minutes are confidential). 14th layering of the self-escalation freeze.

**Confidentiality:** no generic `tg_audit` / `activity_logs` (readable by every user); storage objects registered as BOARD_MINUTES
verifications and the `board_meeting/` attachment prefix need board access (before 0149 every active user could read any `verified/` file);
attachments with `entity_type = 'BOARD_MEETING'` likewise.

## NIL Verify

New document type `BOARD_MINUTES` (doc type row: last page, x 14 / y 9 mm, 20 mm). Issuer gate = `can_approve_board()`, reader gate =
`has_board_access()`. **Public disclosure is minimal: meeting number + meeting date — never members, agenda, discussion or resolutions.**
The renderer keeps the plate's corner free with an empty reserve inside the unbreakable signature block (not by widening every page's
margin). Frozen file served by `/api/board/<id>/pdf`.

## Tests

- `lib/board/board.test.ts` — Tehran time helpers, access tiers, quorum, approval readiness, validation.
- `lib/board/migrations.test.ts` — static guards: RLS + service_role grants, no `tg_audit`, WHERE on every UPDATE/DELETE, restated policies keep
  every earlier clause, minimal public snapshot, INSERT arity.
- `lib/pdf/boardMinutesHtml.test.ts` — 8 sections, escaping, signatures only for present members, no internal ids, draft watermark.
- `lib/verify/pdf.test.ts` — real Chromium render of a 4-page minutes PDF: QR scans, hash lifecycle, nothing underneath covered.
- `supabase/tests/board_integrity.sql` — run by hand in the Supabase SQL editor after 0149 (one transaction, rolled back). Verified locally on
  PGlite (real Postgres) with all 149 migrations applied, including negative controls.

## Phase 2 — follow-up, board bot, reminders (migration 0150)

Decisions (user, 2026-10-09): a **dedicated board bot**; members (internal and external) **report progress from the bot** (status + note +
evidence); **closing is the secretary's decision only**; the frozen minutes PDF goes to **all active linked members**; reminders **3 days
before / on the deadline / every 3 days overdue** at 09:00 Tehran.

- **Follow-up history** `board_resolution_updates` (append-only; WEB or TELEGRAM; who, when, status, note) + `board_resolution_files`
  (evidence under `board_meeting/<meeting>/followup/<resolution>/`, board access only). `follow_status` now changes **only** through
  `board_report_progress` (web, CREATE tier), `board_member_report_progress` (bot, service_role — linked active owner only),
  `board_close_resolution` / `board_reopen_resolution` (APPROVE tier, note required). Web: `/board/resolutions/<id>`.
- **Linking** (Members page → «ساخت لینک اتصال»): a one-time `t.me/<bot>?start=<token>` link, 7 days; only its SHA-256 is stored; a new link
  revokes the previous; one Telegram account = one member; «قطع اتصال» removes it. `board_telegram_links` has **no browser write path** —
  an editor cannot point a member's messages (the minutes) at their own chat.
- **Bot** (`/api/telegram/board-webhook`, `lib/board/telegram/`): unlinked chats get one fixed reply and nothing else. Menu: «مصوبات من»
  (own open resolutions → in progress / done-for-review / blocked → note → optional PDF/JPG/PNG ≤ 10 MB, magic-byte checked, max 5),
  «صورت‌جلسه‌ها» (the frozen verified PDF; never a draft). A member cannot close a resolution from the bot.
- **Notifications** — outbox `board_notifications` (dedupe key, 5-min lease, 8 attempts): minutes + each owner's new resolutions after
  approval; review request to the **notice recipients** (member flag «گیرندهٔ اعلان‌های دبیرخانه» — tick it on your own member row and link
  your Telegram); closed / reopened to the owner; reminders; a daily digest (overdue + awaiting review) to the notice recipients.
- **Signed scan**: approved meeting page → «نسخهٔ امضاشده» (generic attachments, entity `BOARD_MEETING`, board access only).
- `next.config.mjs`: server-action body limit raised to 26 MB (the default 1 MB blocked uploads larger than 1 MB through actions).

### One-time setup (run by the user)

1. **@BotFather** → `/newbot` → e.g. «NIL Board» / `@NilBoard_bot` → copy the token.
2. Server `/root/nil-office/.env.local` (never reuse the other bots' values):
   ```
   BOARD_TELEGRAM_BOT_TOKEN=<token from BotFather>
   BOARD_TELEGRAM_BOT_USERNAME=NilBoard_bot
   BOARD_TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
   BOARD_CRON_SECRET=<openssl rand -hex 32>
   ```
   then `npm run build && pm2 restart nil-office`.
3. Webhook:
   ```
   curl -X POST "https://api.telegram.org/bot<BOARD_TELEGRAM_BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" \
     -d '{"url":"https://office.nil-management.ir/api/telegram/board-webhook","secret_token":"<BOARD_TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
   ```
4. Daily job at 09:00 Tehran (= 05:30 UTC; Iran has no DST; the server runs on UTC — `timedatectl`). A wrapper reads the secret from
   `.env.local`, so the secret is never written into the crontab (as set up live on 2026-10-09):
   ```
   # /root/board-cron.sh  (chmod 700)
   #!/bin/sh
   SECRET=$(grep '^BOARD_CRON_SECRET=' /root/nil-office/.env.local | cut -d= -f2- | tr -d '\r" ')
   curl -fsS -X POST -H "x-board-cron-secret: $SECRET" https://office.nil-management.ir/api/board/cron
   ```
   `crontab -e`: `30 5 * * * /root/board-cron.sh >/dev/null 2>&1`. Manual check: `/root/board-cron.sh` → `{"ok":true,...}`.
   The call is idempotent per Tehran day and also retries earlier failed sends.
5. Linking tip: on some Telegram clients (notably desktop, or when the bot chat already exists) opening the deep link does NOT send the
   code. Then send `/start <code>` manually — the code is the part of the link after `start=`.

### Phase 2 tests

- `lib/board/telegram/telegram.test.ts` — tokens, deep link, constant-time secrets, strict callback parser, 64-byte callback limit, no DONE from
  the bot, every notification text, middleware carve-out, no other bot's tokens/tables.
- `lib/board/migrations.test.ts` (0150 block) — RLS + service_role grants, no browser write path, service-only bot/cron functions, hash-only
  tokens, restated guard keeps every earlier rule, WHERE on every UPDATE/DELETE.
- `supabase/tests/board_followup_integrity.sql` — run after 0150 (rolled back). Verified locally on PGlite with all 150 migrations.

## Phase 3 — assistant drafts from the secretary's notes (migration 0151)

Decisions (user, 2026-10-09): input = the secretary's raw notes as **TEXT only** — typed, pasted, or dictated with the phone keyboard's
microphone (the system never receives or sends audio; the bot rejects voice messages); used from the draft meeting page and from the board
bot (secretary only); the text goes to the LLM provider (Anthropic, same as the internal assistant).

- **Suggest only (ACTA contract).** `lib/board/assistant/draft.ts` makes ONE forced tool call (`submit_minutes_draft`, up to 8k output tokens,
  metered by the assistant's daily token cap); `normalize.ts` then validates every fact: each item must quote the notes and the quote must
  really be in them; an **owner** is kept only if it is a real member AND named in the notes; a **deadline** only if it parses, is not before
  the meeting day and its day + month are written in the item's own quote. Anything dropped stays visible as a hint + warning.
- Stored in `board_ai_drafts` (notes kept as the reference the quotes point into; immutable; PENDING → APPLIED | DISCARDED once).
- **Web** (draft meeting page → «دستیار پیش‌نویس»): notes → suggestion → review: each item ticked by default only when its quote was found;
  missing owners / deadlines must be filled in before applying; the resolution text is editable. «اعمال موارد انتخاب‌شده» =
  `board_apply_ai_draft` — ONE transaction (all or nothing), only into a DRAFT meeting, appending (never overwriting) discussion / intro.
- **Bot** («📝 یادداشت جلسه», only for a member linked to a NIL Office profile with the board CREATE tier — `board_member_drafter_profile`):
  pick a draft meeting → send one or more text messages → «ساخت پیش‌نویس» → the suggestion is stored and the bot sends the review link
  (needs `NEXT_PUBLIC_APP_URL`). Nothing is applied from the bot. **Setup:** link your own member row to your NIL Office user (Members page →
  «کاربر نیل آفیس») and link your Telegram.
- `LLMProvider.converseWithTools` gained optional `maxTokens` / `forceTool` (no change for existing callers).

Tests: `lib/board/assistant/normalize.test.ts` (the never-invent rules), `lib/board/assistant/migration.test.ts` (0151 guards + "suggest
only" code contract), `supabase/tests/board_ai_integrity.sql` (run after 0151; verified on PGlite with all 151 migrations + a negative control).
**Not verified locally:** a real LLM call — the first real use is the live test.

## Next phases

| Phase | Scope |
|---|---|
| 4 | amendment of approved minutes referencing the original |

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

## Next phases

| Phase | Scope |
|---|---|
| 2 | resolution follow-up (progress + evidence + close by the secretary), Telegram for internal + external members (only their own items), reminders, signed-scan upload |
| 3 | assistant: voice / text → draft discussion and resolutions → secretary approves |
| 4 | amendment of approved minutes referencing the original |

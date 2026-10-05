# Clean Start runbook (Operational Clean Start, Mode A)

Run this **only** after explicit human approval. Everything before step 6 is read-only or reversible.

## 0. Prerequisites
- Migration `0141_factory_reset.sql` applied; the app deployed (`git pull && npm run build && pm2 restart nil-office` on the server).
- Server `.env`: `NIL_ENVIRONMENT=uat` (or the real environment). Leave `NIL_ALLOW_PRODUCTION_RESET` unset/`false` unless you are resetting a *production* environment on purpose.
- An ADMIN profile that holds the reset grant. The migration grants **nobody**; the DB owner does it once, in the Supabase SQL editor:
  ```sql
  insert into public.system_reset_grants (profile_id, granted_by, note)
  select id, id, 'SYSTEM_FACTORY_RESET' from public.profiles where role = 'ADMIN' and is_active and full_name = '<NAME OF THE ADMIN>'
  on conflict (profile_id) do update set revoked_at = null, granted_at = now();
  ```
  Revoke afterwards: `update public.system_reset_grants set revoked_at = now() where profile_id = '<uuid>';`

## 1. Read-only Dry Run (SQL)
Run the four queries of `supabase/tests/factory_reset_dry_run_report.sql` one at a time. Check: `executable = true`, no unknown tables, no FK blockers,
admins preserved ≥ 1, row counts per table look like test data, storage unknown objects understood.

## 2. Automated checks (live-safe)
Run `supabase/tests/factory_reset_integrity.sql` (ends with ROLLBACK). Expected: no error.

## 3. Backup — mandatory
Follow `BACKUP_BEFORE_RESET.md`. Note the backup reference and its time (must be ≤ 48 h old when you confirm).

## 4. Dry Run in the app
Settings → «بازنشانی کارخانه» → check numbering baselines (default OUTGOING 69 / INCOMING 18) → «اجرای Dry Run» → review. The plan expires after 30 minutes.

## 5. Confirm
Enter the backup reference + time, tick the backup attestation, type `RESET NIL OFFICE`, tick the second confirmation → «تأیید و آماده‌سازی اجرا» (issues a one-time token valid 10 minutes).

## 6. Execute (point of no return)
«اجرای بازنشانی (غیرقابل برگشت)». Do not close the page. The site answers 503 to everyone else until it finishes. On success the integrity checklist is shown; download the JSON report.
If storage cleanup fails: use «ادامهٔ پاک‌سازی فایل‌ها» from the history table (it never reruns the DB part). If the DB phase fails: nothing was deleted (the transaction rolled back); read the error, fix, take a new Dry Run.

## 7. After the reset
- Log in as the admin; the dashboard must show zeros; Settings, branding (letterhead/stamp/signatures), chart of accounts, fiscal year, templates, roles are intact.
- Re-run `factory_reset_integrity.sql`-style checks if desired, and the manual first-record test **on a test copy** (`RESET_TEST_PLAN.md`) — do not create test records in the clean production baseline.
- Revoke the reset grant (see step 0) and set `NIL_ALLOW_PRODUCTION_RESET` back to `false` if you changed it.
- Enter the real data. The first letter number will be OUTGOING 70 / INCOMING 19 for the configured year; every other domain starts at 1.

# Backup before a reset

A reset is **not reversible by the application**. The only way back is a backup. The application cannot verify that a backup exists or is restorable:
it records the reference and time you give it plus your attestation (`backup_status = CONFIRMED_BY_ADMIN`, shown in the UI as *attested, not verified*), refuses
a reference shorter than 4 characters, a time older than 48 hours or in the future, and an unticked attestation. Do not claim a backup is valid unless you have checked it yourself.

## What to back up (all three)
1. **Database** — Supabase backup: Dashboard → Database → Backups (daily backup / Point-in-Time Recovery if the plan has it). Take a fresh manual backup or note the PITR timestamp
   immediately before the reset. Reference example: `supabase-backup-2026-10-05T08:00Z`.
2. **Storage** — files in the private bucket `nil-files` are **not** part of a database backup. Download/export the bucket (Supabase Dashboard → Storage, or the Storage API / `supabase storage cp -r`)
   or keep a copy of the project's storage backup if your plan provides one. The reset deletes files that belong to deleted records.
3. **Environment/config** — the server `.env` values and the exact deployed commit (`git rev-parse HEAD`).

## Record
| Item | Value |
|---|---|
| Backup reference | |
| Backup time (≤ 48 h) | |
| Storage export location | |
| Deployed commit | |
| Who verified the backup opens/restores | |

## Verify (recommended)
Restore the backup into a **separate** Supabase project / local database and confirm key counts (correspondence, journal entries, personnel). Until you have done this once,
treat the backup as **NOT TESTED**. See `RESTORE_RUNBOOK.md`.

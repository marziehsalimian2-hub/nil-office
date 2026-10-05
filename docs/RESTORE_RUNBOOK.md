# Restore runbook and reset rollback plan

**Status: NOT TESTED.** No automated restore test exists in this project and none was performed. A backup that has never been restored is not proof of safety;
do not treat this document as a PASS. Perform a trial restore into a separate project before relying on it.

## When to restore
- The DB phase **failed**: nothing to restore — the transaction rolled back (`RESET_POSTCHECK_FAILED` / any error). Fix the cause and take a new Dry Run.
- The DB phase **succeeded but the reset turned out to be a mistake**: restore from the backup taken before the reset.
- Only storage cleanup failed: use *Resume* in the history table; no restore needed.

## Database restore (Supabase)
1. Stop traffic: set the app to maintenance (stop PM2 `pm2 stop nil-office`) so nobody writes during the restore.
2. Dashboard → Database → Backups → restore the chosen backup / point-in-time (this replaces the whole database; Auth users and the reset history created after that point are lost).
3. Re-apply nothing: the backup already contains migrations up to its time. If the backup is older than the current code, apply the newer migrations in order before starting the app.
4. Start the app, log in, run the integrity queries (counts of correspondence / journal entries / personnel match the pre-reset Dry Run).

## Storage restore
Re-upload the exported objects to bucket `nil-files` with the **same paths** (the database rows reference exact paths). Verify a few attachments and payslips open.

## Rollback plan summary (RESET_ROLLBACK_PLAN)
| Situation | Action |
|---|---|
| Plan expired / stale / unknown table / FK blocker | Nothing happened; new Dry Run. |
| DB phase error | Automatic rollback; lock released; run `FAILED`; nothing deleted. |
| Storage cleanup error | Run stays resumable; Resume continues pending items only. |
| Integrity check failed | Run `FAILED` with the failed checks; investigate; restore only if data is wrong. |
| Wrong decision after success | Database + storage restore from backup (above). |

## Trial restore checklist (do this once, before the real reset)
- [ ] Created a separate Supabase project / local DB.
- [ ] Restored the latest backup there.
- [ ] Counts match production for 5 key tables.
- [ ] A storage export was re-uploaded and 3 files open.
- [ ] Date and result recorded here: ______

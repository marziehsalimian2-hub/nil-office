# Factory Reset — test plan and what has / has not been run

## Automated in the repository (run by Claude: `npx vitest run`, `tsc`, `eslint`, `next build`)
`lib/system-reset/*.test.ts` — environment guard (missing env ⇒ production, production blocked), typed phrases, strict schemas (no table/SQL/path fields), storage safety net,
maintenance probe, report builder, **manifest vs every migration** (no unclassified table, no PRESERVE→DELETE FK edge for modes A and B, config/business sets), migration safety
(no CASCADE / replica mode / trigger disabling / browser grants / auto-grant), TS↔SQL numbering scopes and phrase consistency, storage rules cover every attachment entity prefix, assistant has no reset action.

## Hand-run SQL (run by the user in the Supabase SQL editor — **NOT RUN by Claude**)
| File | Where | What |
|---|---|---|
| `supabase/tests/factory_reset_dry_run_report.sql` | live, read-only | The Dry Run report (4 queries). |
| `supabase/tests/factory_reset_integrity.sql` | live, rolled back | Permission model, grants, parameter validation, preview read-only, production guard, arm/begin gates, one-shot claim, maintenance lock, execute refusal paths, storage classification. **Never calls the destructive phase with valid arguments.** |
| `supabase/tests/factory_reset_execute_disposable.sql` | **disposable DB only** (refuses unless `set nil.disposable_db = 'yes'`) | The real DB phase inside a rolled-back transaction: all business tables empty, config/profiles/accounts untouched, GLOBAL templates kept, baselines and **first number of every numbering domain** (OUTGOING 70, INCOMING 19, others 1), security audit rows survive, reset history exists, admin still `is_admin()`, idempotent second call, storage bookkeeping + verify. |
| existing payroll / assistant / accounting SQL tests | live, rolled back | Regression (unchanged by this feature; the new migration adds tables and functions only). |

## Manual / not automatable here
- **Login as admin after a real reset** — requires a real Supabase Auth session; covered by the SQL assertions (`is_admin()`, profile active, grant present) and the manual check in `CLEAN_START_RUNBOOK.md` step 7. **E2E: NOT RUN.**
- **Restore from backup** — **NOT TESTED** (`RESTORE_RUNBOOK.md`).
- **Storage deletion through the Storage API** — runs in Node against the real bucket; verify on a test project first (create a few files under `case/…`, run on a disposable project, confirm `settings/…` survives).
- **Maintenance 503** — start a reset on a test project and open another tab.

## Result log (fill in)
| Date | Test | Environment | Result |
|---|---|---|---|
| | factory_reset_dry_run_report | | |
| | factory_reset_integrity | | |
| | factory_reset_execute_disposable | disposable | |

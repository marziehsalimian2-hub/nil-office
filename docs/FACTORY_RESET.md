# Factory Reset / Operational Clean Start v1.0

Permanent, audited, dry-run-first mechanism to remove the **business / operational / test data** of NIL Office (UAT period) and return to a clean
baseline: *a complete, configured system with no real operations recorded yet*. Related: `RESET_MANIFEST.md` (exact scope), `CLEAN_START_RUNBOOK.md`
(how to do it), `BACKUP_BEFORE_RESET.md`, `RESTORE_RUNBOOK.md` (incl. rollback plan), `RESET_SECURITY.md`, `RESET_TEST_PLAN.md`.

**Nothing in the implementation executes a reset.** Real execution is a separate step that needs a human, a backup and the full confirmation flow.

## What survives / what goes (Operational Clean Start, Mode A)
- **Survives:** source code, schema, migrations, Auth users and **all profiles / roles** (profile ≠ personnel), RLS policies, application settings,
  organization branding (letterhead, stamp, signatures — DB paths *and* files), chart of accounts, fiscal years, bank accounts, report/cheque templates,
  CRM pipeline definitions, contract types, service categories, salary-component and legal-rule definitions, Telegram identity links, numbering
  architecture, the reset subsystem and its history.
- **Goes:** correspondence, CRM data (companies, contacts, opportunities, quotations, activities), contracts, proformas/invoices, projects/tasks,
  Client Service Ledger data, receipts/payments/allocations, journal entries, test cheques, personnel/employment/compensation/payroll/payslips,
  trade portal offers and uploads, assistant conversations/pending actions/usage, external intake data, documents/attachments **and their files**, and the
  business rows of the audit log.
- **Numbering:** current Jalali year → configured baselines (default OUTGOING 69 / INCOMING 18 → next 70 / 19; every other domain starts at 1); journal
  counters → 0.

## Modes
| Mode | Status |
|---|---|
| **OPERATIONAL (A)** | Implemented; the mode intended for NIL before go-live. |
| **FULL (B)** | Manifest + **Dry Run only**. Execution is intentionally not implemented in v1 (`MODE_NOT_ENABLED`): it additionally needs Auth Admin API deletes, branding-file removal and a stronger authorization design. |

## The flow (no one-click reset)
1. Choose mode (+ numbering baselines) → 2. **Dry Run** (stores a plan: `reset_plan_id`, manifest hash, schema hash, 30-minute expiry) → 3. review manifest/counts/
storage/unknown/FK blockers → 4. confirm backup (reference + time ≤ 48 h + admin attestation) → 5. exact impact is shown → 6. type `RESET NIL OFFICE` →
7. second explicit confirmation → **arm** (one-time token, 10 min) → 8. **separate request**: server re-validates permission, plan, user, mode, environment, token,
hashes → 9. execute → 10. integrity verification + technical report.
Steps 6–7 are enforced inside the database (`system_reset_arm`), not just in the modal.

## Architecture
- **SQL** (`0141_factory_reset.sql`), every function granted to `service_role` only: `system_reset_preview` (read-only), `system_reset_dry_run`, `system_reset_arm`,
  `system_reset_begin` (atomic one-shot claim + maintenance lock), `system_reset_execute_db` (single transaction), storage bookkeeping
  (`…_storage_pending/mark/complete/retry/scan`), `system_reset_verify`, `system_reset_finish`, `system_reset_fail`, plus the manifest/hash/unknown/FK helpers.
- **Server** (`app/actions/system-reset.ts`, `lib/system-reset/*`): the user's session only identifies the caller; everything privileged goes through the service client.
  The browser sends mode, baselines, confirmation text and plan/run ids — never table names, SQL or storage paths (strict zod schemas).
- **UI** `/settings/system/factory-reset` (link in Settings only for permitted admins): env banner, stepper, history, report download.
- **Middleware** returns 503 to everything except the reset console / login / static assets while the maintenance lock is on.

### The DB phase (one transaction)
Re-checks permission, environment, plan, manifest+schema hash, unknown tables, FK blockers → `LOCK … ACCESS EXCLUSIVE` on every affected table (concurrent writes
are impossible) → counts → snapshots the storage cleanup list → **one `TRUNCATE`** of the manifest delete set (dependency-aware, no CASCADE, row triggers do not fire)
→ restores the GLOBAL report templates → purges business audit rows → resets numbering → in-transaction post-check (every table empty, otherwise **everything rolls back**)
→ records counts + audit events. A failure leaves the database untouched.

### Phases and recovery
`PREPARED → DB_RESET_STARTED → DB_RESET_COMPLETED → STORAGE_CLEANUP_STARTED → STORAGE_CLEANUP_COMPLETED → VERIFICATION → COMPLETED | FAILED`; every transition is a row in
`system_reset_run_events`. The storage list lives in `system_reset_storage_items` (PENDING/DONE/FAILED) and was decided *before* the records vanished, so cleanup is resumable:
**Resume** continues only pending/failed items and never reruns the DB part. Success is never reported while storage cleanup is incomplete or any integrity check fails
(then the run is `FAILED` with the exact failed checks).

### Idempotency and concurrency
`system_reset_begin` claims the plan with one `UPDATE … WHERE status='READY'` — a double click, retry or second tab gets `RESET_PLAN_INVALID` / `RESET_ALREADY_RUNNING`.
`system_reset_execute_db` is a no-op when the run is already past the DB phase. The maintenance lock (`system_maintenance`) is released on completion or failure.

### Audit
Durable events in `activity_logs` (`entity_type='system_reset'`, never purged): dry run, armed, started, DB completed, completed/failed — with reset id, user, mode, environment,
backup reference, counts. `system_reset_runs` keeps the full history (counts before/deleted, storage cleanup, integrity result, report) and survives every reset.

## Environment
`NIL_ENVIRONMENT` = `development | uat | production` (missing/invalid ⇒ **production**). Production is refused unless the server also has `NIL_ALLOW_PRODUCTION_RESET=true`.
The database re-checks the environment recorded in the plan. Currently configured as **UAT**.

## Multi-tenant / productization readiness
Plans and runs carry `tenant_key` (default `'default'`) and the manifest is table-scoped, so the architecture does not assume "destroy the whole database".
**Limitation:** the application is single-tenant today — no business table has a tenant column — so *per-tenant* deletion (Reset Tenant A without Tenant B) is **not possible yet**
and would require tenant columns plus tenant-scoped deletes. Reusable as-is for Demo/UAT/QA environment resets.

## Known limitations
- Backup validity cannot be verified by the application (only attested); restore has never been exercised (`RESTORE_RUNBOOK.md`: NOT TESTED).
- The Assistant has no reset action by design; Telegram webhooks get 503 during a reset and are retried by Telegram.
- Mode B is not executable. Auth users are never deleted by Mode A.

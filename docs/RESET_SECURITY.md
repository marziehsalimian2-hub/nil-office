# Factory Reset — security model

| Control | Where it is enforced |
|---|---|
| Dedicated permission `SYSTEM_FACTORY_RESET` = active `ADMIN` profile **and** a non-revoked row in `system_reset_grants`. Not granted to anyone by the migration; ordinary admins do not have it. | `system_reset_has_permission()`; checked on page load, in every server action, in every RPC, and again inside `system_reset_execute_db` immediately before execution. |
| No browser path to destructive logic | All `system_reset_*` / `_srs_*` functions are `revoke all … from public, anon, authenticated; grant … to service_role`. The tables have RLS on, **no policies**, no grants to browser roles. Only `system_maintenance_status()` (returns `{locked: bool}`) is public. |
| Server-side only | The user's session identifies the caller; privileged calls use the service client (`lib/supabase/service.ts`, server-only). |
| Scope comes from the trusted manifest | Strict zod schemas reject any table list / SQL / path field; table names reach SQL only via the manifest and `format('%I')` after a catalog check (`_srs_count`); storage paths come only from the DB-built cleanup list and pass `isSafeStoragePath` / branding guard again in Node. No raw SQL, no LLM-generated SQL, no `execute_sql`. |
| Production guard | `NIL_ENVIRONMENT` decided on the server (missing ⇒ production); production refused without `NIL_ALLOW_PRODUCTION_RESET=true`; the DB re-checks the plan's environment (`RESET_PRODUCTION_BLOCKED`, `RESET_PLAN_STALE`). |
| Plan integrity | Plan binds user, mode, environment, manifest hash, schema hash, 30-minute expiry; arm/begin/execute each re-validate; a changed manifest or schema ⇒ `RESET_PLAN_STALE`; another admin's plan ⇒ `RESET_PLAN_INVALID`. |
| Two-request confirmation | Typed phrase + second confirmation + backup attestation at **arm** (DB-enforced), then a **separate** request with a one-time token (stored only as SHA-256, 10 min). |
| Idempotency | One-shot atomic claim of the plan; the DB phase is a no-op once done. |
| Concurrency | `ACCESS EXCLUSIVE` locks on all affected tables for the transaction + maintenance lock (503 for the rest of the site). |
| No blanket integrity bypass | No `CASCADE`, no `session_replication_role`, no trigger disabling. `TRUNCATE` is dependency-aware; the in-transaction post-check rolls everything back on any non-empty table. |
| Audit | `system_reset` events are never purged; history rows survive every reset; the report contains counts/ids/codes only. |
| Assistant | No reset action exists in the Action Registry; a vitest scan fails if one appears or if assistant code references the reset RPCs/actions. Telegram webhooks cannot reach the reset actions. |
| Secrets | Token never stored in clear; reports and logs contain no credentials; the service-role key stays server-side. |

## Residual risks / honest notes
- Anyone with direct DB-owner access (Supabase SQL editor as `postgres`) can call the functions — by design the owner is trusted.
- Backup validity is an attestation, not a verification.
- `system_maintenance_status()` is anon-readable (one boolean); the middleware probe fails **open** if it errors, because during a real reset the database locks already block writes.
- Reset permission grants are manual SQL by the DB owner; there is no UI to self-grant.

-- =====================================================================
-- NIL Office — 0103_cash_allocations_rls.sql
-- Financial Receipts & Payments — Phase 1, part 3 (RLS + grants).
-- Same shape as accounting_sequences (0009_accounting_rls.sql): SELECT
-- policy only, gated on has_accounting_access() — no INSERT/UPDATE/
-- DELETE policy at all, since the only sanctioned writer is the
-- SECURITY DEFINER set_cash_allocations() (0102).
-- =====================================================================

alter table public.cash_allocations enable row level security;
alter table public.cash_allocations force row level security;

drop policy if exists p_cash_allocations_read on public.cash_allocations;
create policy p_cash_allocations_read on public.cash_allocations
  for select using (public.has_accounting_access());

-- Mandatory base grants (0013_table_grants.sql gotcha) — RLS above does
-- the real gating for authenticated. service_role needs its own
-- explicit grant too since 0072/0096's blanket grants are one-time
-- snapshots, never retroactive to a table created after them.
grant select, insert, update, delete on public.cash_allocations to authenticated;
grant select, insert, update, delete on public.cash_allocations to service_role;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop policy if exists p_cash_allocations_read on public.cash_allocations;
-- revoke select, insert, update, delete on public.cash_allocations from authenticated, service_role;
-- =====================================================================

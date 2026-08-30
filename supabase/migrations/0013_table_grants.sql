-- =====================================================================
-- NIL Office — 0013_table_grants.sql
--
-- CRITICAL FIX: every table in this project has RLS policies, but a
-- CREATE POLICY only *restricts* rows an operation is already allowed to
-- touch — Postgres still checks the underlying object privilege first.
-- None of 0001–0012 ever ran a base `GRANT ... ON TABLE ... TO
-- authenticated`, so every query from the app (including a user simply
-- reading their own, active `profiles` row) fails at the object-privilege
-- check with `permission denied for table ...` (42501), before RLS is
-- even evaluated. This affects every table below, for every user.
--
-- This migration grants the operations each table's own RLS policies
-- already allow; RLS continues to do all of the real access control.
-- Safe to run multiple times.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.companies,
  public.cases,
  public.correspondence,
  public.correspondence_links,
  public.documents,
  public.attachments,
  public.followups,
  public.app_settings,
  public.fiscal_years,
  public.accounts,
  public.detail_accounts,
  public.journal_entries,
  public.journal_entry_lines,
  public.bank_accounts,
  public.receipts,
  public.payments
to authenticated;

-- Read-only at the grant level for tables normal users never write to
-- directly (writes happen exclusively through SECURITY DEFINER RPCs);
-- RLS already enforces this too, but there's no reason to grant more.
grant select on
  public.number_sequences,
  public.accounting_sequences,
  public.activity_logs
to authenticated;

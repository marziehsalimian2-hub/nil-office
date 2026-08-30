-- =====================================================================
-- NIL Office — 0015_fix_fiscal_years_updated_at.sql
--
-- BUG: migration 0007 attaches the generic `tg_touch_updated_at` trigger
-- (which unconditionally does `new.updated_at = now()`) to fiscal_years,
-- but fiscal_years was never given an `updated_at` column like its
-- sibling tables (accounts, journal_entries, bank_accounts, ...). Every
-- UPDATE on fiscal_years — including close_fiscal_year — has therefore
-- always failed with Postgres error 42703 "record \"new\" has no field
-- \"updated_at\"". No fiscal year could ever be closed.
--
-- Fix: add the missing column so the existing trigger works as intended,
-- consistent with every other table it's attached to.
-- =====================================================================

alter table public.fiscal_years
  add column if not exists updated_at timestamptz not null default now();

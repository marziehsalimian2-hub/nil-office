-- =====================================================================
-- NIL Office — 0068_dashboard_settings.sql
-- Executive Dashboard — two new configurable thresholds on the existing
-- app_settings singleton (already extended incrementally by 0017/0062;
-- this is that same established pattern, not a new settings engine).
-- No RLS change needed — app_settings' existing policies (0009:
-- "everyone active reads, admin writes") already cover any new column.
--
-- CRM's stale-opportunity threshold is DELIBERATELY not made
-- configurable here — opportunities/page.tsx?status=stale already calls
-- get_stale_crm_opportunities(14) with a hardcoded literal, and the
-- dashboard reuses that same function+literal unmodified. Parameterizing
-- only the dashboard's copy would silently break the zero-discrepancy
-- guarantee between the dashboard count and its own drill-down link the
-- moment an admin changed it.
-- =====================================================================

alter table public.app_settings
  add column if not exists dashboard_contract_expiry_days int not null default 30
    check (dashboard_contract_expiry_days > 0);

alter table public.app_settings
  add column if not exists dashboard_project_ending_soon_days int not null default 14
    check (dashboard_project_ending_soon_days > 0);

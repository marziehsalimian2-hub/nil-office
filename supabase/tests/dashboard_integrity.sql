-- =============================================================================
-- NIL Office — Executive Dashboard integrity tests.
--
-- Run in the Supabase SQL editor AFTER migration 0068. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- Scope note: the Executive Dashboard is almost entirely a TypeScript
-- read/aggregation layer (lib/dashboard/*.ts) that reuses existing SQL
-- functions/filters verbatim (get_project_progress_summary,
-- get_stale_crm_opportunities, v_trial_balance) rather than introducing
-- new ones — see the plan's decision #2/#9. There is therefore very
-- little NEW server-side surface to integrity-test here: only the two
-- new app_settings columns from migration 0068. The zero-discrepancy
-- guarantee between dashboard counts and their drill-down links (spec
-- §33/§68) is a TypeScript-level property (identical filters used on
-- both sides of each pair) and is documented, not re-tested in SQL —
-- see the "zero-discrepancy walkthrough" in the implementation report.
--
-- Covered: app_settings still has exactly one row; the two new columns
-- default correctly; both reject non-positive values via their CHECK
-- constraints; existing reused functions (get_project_progress_summary,
-- get_stale_crm_opportunities) are still callable without error.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_count int;
  v_expiry_days int;
  v_ending_soon_days int;
  v_msg text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1) app_settings is still a genuine singleton -----------------------
  select count(*) into v_count from public.app_settings;
  if v_count <> 1 then raise exception 'FAIL(1): expected exactly 1 app_settings row, found %', v_count; end if;
  raise notice 'PASS(1): app_settings singleton intact';

  -- 2) new threshold columns default correctly ---------------------------
  select dashboard_contract_expiry_days, dashboard_project_ending_soon_days
    into v_expiry_days, v_ending_soon_days
    from public.app_settings where id = 1;
  if v_expiry_days <> 30 then raise exception 'FAIL(2): expected default dashboard_contract_expiry_days=30, got %', v_expiry_days; end if;
  if v_ending_soon_days <> 14 then raise exception 'FAIL(2): expected default dashboard_project_ending_soon_days=14, got %', v_ending_soon_days; end if;
  raise notice 'PASS(2): threshold defaults correct (30 / 14)';

  -- 3) CHECK constraints reject non-positive thresholds -------------------
  begin
    update public.app_settings set dashboard_contract_expiry_days = 0 where id = 1;
    raise exception 'FAIL(3): a zero contract-expiry threshold was accepted';
  exception when check_violation then
    raise notice 'PASS(3): zero contract-expiry threshold rejected';
  end;

  begin
    update public.app_settings set dashboard_project_ending_soon_days = -5 where id = 1;
    raise exception 'FAIL(3b): a negative project-ending-soon threshold was accepted';
  exception when check_violation then
    raise notice 'PASS(3b): negative project-ending-soon threshold rejected';
  end;

  -- 4) reused functions are still callable (sanity, not new logic) --------
  perform * from public.get_project_progress_summary() limit 1;
  raise notice 'PASS(4a): get_project_progress_summary() callable';

  perform * from public.get_stale_crm_opportunities(14) limit 1;
  raise notice 'PASS(4b): get_stale_crm_opportunities(14) callable';

  raise notice '===== ALL DASHBOARD INTEGRITY TESTS PASSED =====';
end $$;

rollback;

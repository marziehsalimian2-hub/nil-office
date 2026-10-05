-- =============================================================================
-- NIL Office — Factory Reset: FULL EXECUTION test. *** DISPOSABLE DATABASE ONLY ***
--
-- This script runs the real destructive DB phase (system_reset_execute_db: lock + TRUNCATE of the whole manifest delete set)
-- inside ONE transaction and ROLLS IT BACK. Even so it takes ACCESS EXCLUSIVE locks on ~80 tables and must NEVER be run on the
-- live NIL Office database. It REFUSES to run unless you deliberately say the database is disposable, in the SAME session:
--
--     set nil.disposable_db = 'yes';
--
-- (e.g. a Supabase branch / a restored copy / a local database). NOT RUN by Claude — and not meant to be run on production.
-- Success = the statement finishes with no error.
--
-- What it proves (after the transaction's own execution): every business table is empty; the config / chart of accounts / fiscal years /
-- profiles / branding settings are untouched; global report templates survive; sequences sit at the configured baselines so the FIRST new
-- record of every numbering domain gets exactly baseline + 1 (OUTGOING 70, INCOMING 19, everything else 1); the admin still passes is_admin();
-- reset history + audit events exist; business audit rows are purged while security rows survive; storage cleanup bookkeeping is resumable;
-- the DB phase is idempotent (second call is a no-op); a second begin on the used plan fails; the maintenance lock is released at the end.
-- =============================================================================
begin;

do $$
begin
  if coalesce(current_setting('nil.disposable_db', true), '') <> 'yes' then
    raise exception 'REFUSED: this test truncates ~80 tables (inside a rolled-back transaction). Run it only on a disposable database after: set nil.disposable_db = ''yes'';';
  end if;
end $$;

create function pg_temp.expect_err(p_sql text, p_code text) returns void
language plpgsql as $$
declare m text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics m = message_text;
    if position(p_code in m) = 0 then raise exception 'FAIL: expected %, got: %', p_code, m; end if;
    return;
  end;
  raise exception 'FAIL: no error raised, expected %', p_code;
end $$;

create function pg_temp.chk(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL(%)', p_label; end if;
end $$;

do $$
declare
  v_admin uuid; v_plan uuid; v_token text; v_run uuid; v_res jsonb; v_ver jsonb; v_case uuid; v_company uuid; v_scope text; v_n integer; v_year int := 1405;
  v_ts timestamptz := now() - interval '1 hour';
  v_params jsonb := '{"current_year":1405,"baselines":{"OUTGOING":69,"INCOMING":18}}'::jsonb;
  v_tpl_global bigint; v_profiles bigint; v_accounts bigint; v_fy bigint; v_keep_audit bigint; v_pending jsonb; v_items bigint; v_set text[]; t text; v_cnt bigint;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  insert into public.system_reset_grants (profile_id, granted_by, note) values (v_admin, v_admin, 'disposable execution test')
    on conflict (profile_id) do update set revoked_at = null;

  -- fixtures that the reset must remove (and one config row that must stay)
  insert into public.companies (legal_name, created_by) values ('Reset test company', v_admin) returning id into v_company;
  insert into public.cases (title, created_by) values ('Reset test case', v_admin) returning id into v_case;
  insert into public.attachments (entity_type, entity_id, file_name, storage_path, uploaded_by)
    values ('CASE', v_case, 'x.pdf', 'case/reset-test/x.pdf', v_admin);
  insert into storage.objects (bucket_id, name) values ('nil-files', 'case/reset-test/x.pdf'), ('nil-files', 'settings/branding-test.png');
  insert into public.number_sequences (scope, year, last_value) values ('OUTGOING', v_year, 130), ('INVOICE', v_year, 7), ('CASE', v_year - 1, 3)
    on conflict (scope, year) do update set last_value = excluded.last_value;
  insert into public.activity_logs (user_id, entity_type, entity_id, action) values (v_admin, 'number_sequences', null, 'INIT_SEQUENCE_TEST');   -- security/config audit row: must SURVIVE

  select count(*) into v_tpl_global from public.client_service_report_templates where scope = 'GLOBAL';
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_accounts from public.accounts;
  select count(*) into v_fy from public.fiscal_years;

  -- plan -> arm -> begin -> execute
  v_res := public.system_reset_dry_run(v_admin, 'OPERATIONAL', v_params, 'uat', false);
  v_plan := (v_res ->> 'plan_id')::uuid;
  perform pg_temp.chk('dry run sees the fixtures', (v_res #>> '{preview,totals,rows_to_delete}')::bigint >= 3);
  v_token := public.system_reset_arm(v_admin, v_plan, 'RESET NIL OFFICE', true, 'disposable-backup', v_ts, 'CONFIRMED_BY_ADMIN', 'uat', false);
  v_run := public.system_reset_begin(v_admin, v_plan, v_token, 'uat', false);
  perform pg_temp.chk('lock ON during the reset', (public.system_maintenance_status() ->> 'locked')::boolean);

  v_res := public.system_reset_execute_db(v_admin, v_run, 'uat', false);
  perform pg_temp.chk('DB phase completed', v_res ->> 'phase' = 'DB_RESET_COMPLETED');
  perform pg_temp.chk('idempotent: the DB phase never runs twice', (public.system_reset_execute_db(v_admin, v_run, 'uat', false) ->> 'already_done')::boolean);
  perform pg_temp.expect_err(format('select public.system_reset_begin(%L,%L,%L,%L,false)', v_admin, v_plan, v_token, 'uat'), 'RESET_PLAN_INVALID');

  -- every business table is empty
  v_set := public._srs_set('OPERATIONAL');
  foreach t in array v_set loop
    if t <> 'client_service_report_templates' then
      perform pg_temp.chk('empty: ' || t, public._srs_count(t) = 0);
    end if;
  end loop;
  perform pg_temp.chk('client-scope templates are gone, GLOBAL ones are back',
    (select count(*) from public.client_service_report_templates where scope <> 'GLOBAL') = 0
    and (select count(*) from public.client_service_report_templates where scope = 'GLOBAL') = v_tpl_global);

  -- configuration is untouched
  perform pg_temp.chk('profiles / accounts / fiscal years / settings untouched',
    (select count(*) from public.profiles) = v_profiles and (select count(*) from public.accounts) = v_accounts
    and (select count(*) from public.fiscal_years) = v_fy and exists (select 1 from public.app_settings where id = 1));
  perform pg_temp.chk('reset subsystem + manifest intact', (select count(*) from public.system_reset_manifest) >= 113 and exists (select 1 from public.system_reset_runs where id = v_run));

  -- numbering: configured baselines for the current year, 0 for other years, journal counters at 0
  perform pg_temp.chk('OUTGOING baseline', (select last_value from public.number_sequences where scope = 'OUTGOING' and year = v_year) = 69);
  perform pg_temp.chk('INCOMING baseline created', (select last_value from public.number_sequences where scope = 'INCOMING' and year = v_year) = 18);
  perform pg_temp.chk('INVOICE reset to 0', coalesce((select last_value from public.number_sequences where scope = 'INVOICE' and year = v_year), 0) = 0);
  perform pg_temp.chk('other years reset to 0', coalesce((select last_value from public.number_sequences where scope = 'CASE' and year = v_year - 1), 0) = 0);
  perform pg_temp.chk('journal counters at 0', (select count(*) from public.accounting_sequences where last_value <> 0) = 0);
  -- audit: business rows purged, security rows and the reset's own events kept
  perform pg_temp.chk('security audit row survives', exists (select 1 from public.activity_logs where action = 'INIT_SEQUENCE_TEST'));
  perform pg_temp.chk('business audit rows are gone', not exists (select 1 from public.activity_logs where entity_type = any (public._srs_audit_types('OPERATIONAL'))));
  perform pg_temp.chk('the reset itself is audited and survives', exists (select 1 from public.activity_logs where entity_type = 'system_reset' and entity_id = v_run and action = 'FACTORY_RESET_DB_COMPLETED'));
  perform pg_temp.chk('before/deleted counts recorded', (select counts_deleted from public.system_reset_runs where id = v_run) is not null
                      and (select (counts_deleted ->> 'companies')::int from public.system_reset_runs where id = v_run) >= 1);

  -- admin access survives
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform pg_temp.chk('admin still passes is_admin()', public.is_admin());

  -- storage bookkeeping: the list was decided BEFORE the records vanished; branding is not on it
  perform pg_temp.chk('the deleted file is on the cleanup list', exists (select 1 from public.system_reset_storage_items i where i.run_id = v_run and i.path = 'case/reset-test/x.pdf'));
  perform pg_temp.chk('branding is NOT on the cleanup list', not exists (select 1 from public.system_reset_storage_items i where i.run_id = v_run and i.path like 'settings/%'));
  v_ver := public.system_reset_verify(v_admin, v_run);
  perform pg_temp.chk('verify refuses to pass while storage cleanup is incomplete',
    not (v_ver ->> 'ok')::boolean and exists (select 1 from jsonb_array_elements(v_ver -> 'checks') c where c ->> 'key' = 'STORAGE_CLEANUP_COMPLETE' and not (c ->> 'ok')::boolean));
  perform pg_temp.expect_err(format('select public.system_reset_storage_complete(%L,%L)', v_admin, v_run), 'RESET_STORAGE_INCOMPLETE');
  v_pending := public.system_reset_storage_pending(v_admin, v_run, 100);
  perform pg_temp.chk('pending list returned', jsonb_array_length(v_pending) >= 1);
  perform public.system_reset_storage_mark(v_admin, v_run, array(select jsonb_array_elements_text(v_pending)), null);        -- (the Node side removes the real files; SQL only records)
  perform public.system_reset_storage_complete(v_admin, v_run);
  v_ver := public.system_reset_verify(v_admin, v_run);
  perform pg_temp.chk('every integrity check passes: ' || v_ver::text, (v_ver ->> 'ok')::boolean);
  perform public.system_reset_finish(v_admin, v_run, v_ver, '{}'::jsonb);
  perform pg_temp.chk('run COMPLETED and lock released',
    (select status from public.system_reset_runs where id = v_run) = 'COMPLETED' and not (public.system_maintenance_status() ->> 'locked')::boolean);

  -- first number of every domain (after verification: allocating moves the counters off their baselines)
  for v_scope in select unnest(array['OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER','CHEQUE','RECEIPT','PAYMENT','PERSONNEL','PAYROLL_BATCH']) loop
    v_n := public.allocate_sequence(v_scope, v_year);
    perform pg_temp.chk('first number of ' || v_scope,
      v_n = case v_scope when 'OUTGOING' then 70 when 'INCOMING' then 19 else 1 end);
  end loop;

  raise notice 'PASS: factory_reset_execute_disposable (rolled back)';
end $$;

rollback;

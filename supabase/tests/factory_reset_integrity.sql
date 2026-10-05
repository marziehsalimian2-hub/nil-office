-- =============================================================================
-- NIL Office — Factory Reset / Clean Start (migration 0141): LIVE-SAFE integrity + security tests.
-- Run by hand in the Supabase SQL editor AFTER migration 0141, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. NOTHING IN THIS FILE EXECUTES THE DESTRUCTIVE PHASE: it never calls
-- system_reset_execute_db with valid arguments — only with arguments that must be refused BEFORE any lock / truncate
-- (wrong environment). It creates plans / a run / the maintenance lock inside the rolled-back transaction only.
-- It temporarily grants the test permission to the first ADMIN profile (rolled back) and re-roles it (rolled back).
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Covers: manifest completeness (no UNKNOWN table, no FK blocker), hashes, permission model (ordinary admin / non-admin / revoked),
-- grants (nothing destructive reachable by anon / authenticated), parameter validation, preview is read-only, dry-run production guard,
-- arm gates (phrase, second confirmation, backup, mode, plan owner, expiry, stale manifest), begin gates (token, one-shot claim,
-- production guard, maintenance lock), execute refusal paths, storage classification (branding never selected, unknown kept).
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', p_role)::text, true);
  execute format('set role %I', p_role);
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
  v_admin uuid; v_user uuid; v_plan jsonb; v_plan_id uuid; v_other_plan uuid; v_token text; v_run uuid; v_prev jsonb; v_prev2 jsonb;
  v_before bigint; v_after bigint; v_n_plans bigint; v_ts timestamptz := now() - interval '1 hour';
  c_params constant jsonb := '{"current_year":1405,"baselines":{"OUTGOING":69,"INCOMING":18}}'::jsonb;
  s_lh text := 'correspondence/lh-test.png';
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  select id into v_user from public.profiles where role <> 'ADMIN' and is_active limit 1;   -- may be null on a tiny database

  -- 1) manifest vs the actual catalog ---------------------------------------------------------------------------------------------------
  perform pg_temp.chk('manifest rows', (select count(*) from public.system_reset_manifest) >= 113);
  perform pg_temp.chk('no UNKNOWN table (every public table is classified)', public.system_reset_unknown_tables() = '{}'::text[]);
  perform pg_temp.chk('no manifest row without a table', public.system_reset_missing_objects() = '{}'::text[]);
  perform pg_temp.chk('no FK blocker for OPERATIONAL', public.system_reset_fk_blockers('OPERATIONAL') = '[]'::jsonb);
  perform pg_temp.chk('truncate set size', coalesce(array_length(public._srs_set('OPERATIONAL'), 1), 0) = 79);
  perform pg_temp.chk('hashes', length(public.system_reset_manifest_hash()) = 32 and length(public.system_reset_schema_hash()) = 32);
  perform pg_temp.chk('config tables are NOT in the delete set',
    not (public._srs_set('OPERATIONAL') && array['profiles','app_settings','accounts','fiscal_years','bank_accounts','number_sequences','accounting_sequences','activity_logs',
                                                 'cheque_status_transitions','payroll_batch_transitions','legal_rule_sets','salary_components','system_reset_runs','system_reset_grants']));
  perform pg_temp.chk('business tables ARE in the delete set',
    public._srs_set('OPERATIONAL') @> array['journal_entries','journal_entry_lines','correspondence','companies','sales_documents','personnel','payroll_payslips','cheques','attachments']);

  -- 2) grants: nothing destructive is reachable by a browser role -------------------------------------------------------------------------
  perform pg_temp.chk('authenticated cannot execute dry run', not has_function_privilege('authenticated', 'public.system_reset_dry_run(uuid,text,jsonb,text,boolean)', 'execute'));
  perform pg_temp.chk('authenticated cannot execute the DB phase', not has_function_privilege('authenticated', 'public.system_reset_execute_db(uuid,uuid,text,boolean)', 'execute'));
  perform pg_temp.chk('anon cannot execute the DB phase', not has_function_privilege('anon', 'public.system_reset_execute_db(uuid,uuid,text,boolean)', 'execute'));
  perform pg_temp.chk('service_role can', has_function_privilege('service_role', 'public.system_reset_execute_db(uuid,uuid,text,boolean)', 'execute'));
  perform pg_temp.chk('lock probe is public', has_function_privilege('anon', 'public.system_maintenance_status()', 'execute'));
  perform pg_temp.chk('no table access for browser roles',
    not has_table_privilege('authenticated', 'public.system_reset_runs', 'select') and not has_table_privilege('anon', 'public.system_reset_plans', 'select')
    and not has_table_privilege('authenticated', 'public.system_reset_grants', 'insert') and not has_table_privilege('authenticated', 'public.system_maintenance', 'update'));
  perform pg_temp.persona(v_admin, 'authenticated');
  perform pg_temp.expect_err(format('select public.system_reset_dry_run(%L,%L,%L,%L,false)', v_admin, 'OPERATIONAL', c_params, 'uat'), 'permission denied');
  perform pg_temp.expect_err('select public.system_reset_preview(''OPERATIONAL'', ''{}''::jsonb)', 'permission denied');
  perform pg_temp.expect_err('select * from public.system_reset_runs', 'permission denied');
  execute 'reset role';
  perform pg_temp.persona(v_admin, 'anon');
  perform pg_temp.chk('anon can read ONLY the lock bool', (public.system_maintenance_status() ->> 'locked')::boolean = false);
  execute 'reset role';

  -- 3) permission SYSTEM_FACTORY_RESET = active ADMIN + explicit grant ----------------------------------------------------------------------
  update public.system_reset_grants set revoked_at = now() where profile_id = v_admin;        -- (rolled back) start from "no grant"
  perform pg_temp.chk('ADMIN without a grant has no reset permission', not public.system_reset_has_permission(v_admin));
  perform pg_temp.expect_err(format('select public.system_reset_dry_run(%L,%L,%L,%L,false)', v_admin, 'OPERATIONAL', c_params, 'uat'), 'NOT_AUTHORIZED');
  insert into public.system_reset_grants (profile_id, granted_by, note) values (v_admin, v_admin, 'integrity test')
    on conflict (profile_id) do update set revoked_at = null, granted_at = now();
  perform pg_temp.chk('ADMIN with a grant has it', public.system_reset_has_permission(v_admin));
  if v_user is not null then
    insert into public.system_reset_grants (profile_id, note) values (v_user, 'non-admin with a grant') on conflict (profile_id) do update set revoked_at = null;
    perform pg_temp.chk('a grant alone is not enough: the profile must be an active ADMIN', not public.system_reset_has_permission(v_user));
    perform pg_temp.expect_err(format('select public.system_reset_dry_run(%L,%L,%L,%L,false)', v_user, 'OPERATIONAL', c_params, 'uat'), 'NOT_AUTHORIZED');
  end if;
  perform pg_temp.chk('null user has no permission', not public.system_reset_has_permission(null));
  perform pg_temp.chk('random uuid has no permission', not public.system_reset_has_permission(gen_random_uuid()));

  -- 4) parameters: only current_year + known scopes + non-negative integers --------------------------------------------------------------
  perform pg_temp.expect_err($q$select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"tables":["profiles"]}'::jsonb)$q$, 'RESET_PARAMS_INVALID');
  perform pg_temp.expect_err($q$select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"EVIL":1}}'::jsonb)$q$, 'RESET_PARAMS_INVALID');
  perform pg_temp.expect_err($q$select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"OUTGOING":-1}}'::jsonb)$q$, 'RESET_PARAMS_INVALID');
  perform pg_temp.expect_err($q$select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"OUTGOING":"69"}}'::jsonb)$q$, 'RESET_PARAMS_INVALID');
  perform pg_temp.expect_err($q$select public.system_reset_preview('OPERATIONAL', '{"current_year":12}'::jsonb)$q$, 'RESET_PARAMS_INVALID');
  perform pg_temp.expect_err($q$select public.system_reset_preview('OPERATIONAL', '{}'::jsonb)$q$, 'RESET_PARAMS_INVALID');
  perform pg_temp.expect_err($q$select public.system_reset_preview('NUKE', '{"current_year":1405}'::jsonb)$q$, 'RESET_MODE_INVALID');

  -- 5) preview is read-only and complete ---------------------------------------------------------------------------------------------------
  select count(*) into v_n_plans from public.system_reset_plans;
  select (select count(*) from public.correspondence) + (select count(*) from public.journal_entries) + (select count(*) from public.companies) into v_before;
  v_prev := public.system_reset_preview('OPERATIONAL', c_params);
  select (select count(*) from public.correspondence) + (select count(*) from public.journal_entries) + (select count(*) from public.companies) into v_after;
  perform pg_temp.chk('preview deletes nothing', v_before = v_after);
  perform pg_temp.chk('preview stores nothing', (select count(*) from public.system_reset_plans) = v_n_plans);
  perform pg_temp.chk('preview: executable', (v_prev ->> 'executable')::boolean);
  perform pg_temp.chk('preview: 79 tables', (v_prev #>> '{totals,tables}')::int = 79);
  perform pg_temp.chk('preview: unknown tables empty', v_prev -> 'unknown_tables' = '[]'::jsonb and v_prev -> 'fk_blockers' = '[]'::jsonb and v_prev -> 'missing_manifest_objects' = '[]'::jsonb);
  perform pg_temp.chk('preview: admins preserved', (v_prev #>> '{admins_preserved,count}')::int >= 1);
  perform pg_temp.chk('preview: baselines echoed', v_prev #>> '{params,baselines,OUTGOING}' = '69' and v_prev #>> '{params,baselines,INCOMING}' = '18');
  perform pg_temp.chk('preview: preserved list holds profiles and accounts',
    exists (select 1 from jsonb_array_elements(v_prev -> 'tables_preserved') t where t ->> 'name' = 'profiles')
    and exists (select 1 from jsonb_array_elements(v_prev -> 'tables_preserved') t where t ->> 'name' = 'accounts'));
  perform pg_temp.chk('preview: the reset subsystem itself is never listed for deletion',
    not exists (select 1 from jsonb_array_elements(v_prev -> 'tables_to_delete') t where t ->> 'name' like 'system\_%'));
  v_prev2 := public.system_reset_preview('FULL', c_params);
  perform pg_temp.chk('FULL mode: dry run only (never executable)', not (v_prev2 ->> 'executable')::boolean and v_prev2 -> 'warnings' ? 'MODE_FULL_DRY_RUN_ONLY');

  -- 6) dry run: environment + production guard --------------------------------------------------------------------------------------------
  perform pg_temp.expect_err(format('select public.system_reset_dry_run(%L,%L,%L,%L,false)', v_admin, 'OPERATIONAL', c_params, 'production'), 'RESET_PRODUCTION_BLOCKED');
  perform pg_temp.expect_err(format('select public.system_reset_dry_run(%L,%L,%L,%L,false)', v_admin, 'OPERATIONAL', c_params, 'staging'), 'RESET_ENVIRONMENT_INVALID');
  perform pg_temp.expect_err(format('select public.system_reset_dry_run(%L,%L,%L,%L,false)', v_admin, 'OPERATIONAL', c_params, null), 'RESET_ENVIRONMENT_INVALID');
  v_plan := public.system_reset_dry_run(v_admin, 'OPERATIONAL', c_params, 'uat', false);
  v_plan_id := (v_plan ->> 'plan_id')::uuid;
  perform pg_temp.chk('plan stored with hashes, expiry and status',
    exists (select 1 from public.system_reset_plans p where p.id = v_plan_id and p.status = 'PLANNED' and p.created_by = v_admin and p.environment = 'uat'
                 and p.manifest_hash = public.system_reset_manifest_hash() and p.schema_hash = public.system_reset_schema_hash()
                 and p.expires_at > now() and p.expires_at <= now() + interval '31 minutes'));
  perform pg_temp.chk('the dry run is audited', exists (select 1 from public.activity_logs where entity_type = 'system_reset' and entity_id = v_plan_id and action = 'FACTORY_RESET_DRY_RUN'));

  -- 7) arm gates ---------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'reset nil office', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_CONFIRMATION_INVALID');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,false,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_CONFIRMATION_INVALID');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'ab', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_BACKUP_REQUIRED');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', now() - interval '3 days', 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_BACKUP_REQUIRED');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', now() + interval '2 hours', 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_BACKUP_REQUIRED');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', v_ts, 'VERIFIED', 'uat'), 'RESET_BACKUP_REQUIRED');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'development'), 'RESET_PLAN_STALE');   -- another environment
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'production'), 'RESET_PRODUCTION_BLOCKED');
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, gen_random_uuid(), 'RESET NIL OFFICE', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_PLAN_INVALID');
  if v_user is not null then
    update public.profiles set role = 'ADMIN' where id = v_user;                                                        -- (rolled back) a SECOND admin tries to use the first one's plan
    perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_user, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_PLAN_INVALID');
    update public.profiles set role = 'USER' where id = v_user;
  end if;
  -- FULL mode can be planned but never armed
  v_other_plan := (public.system_reset_dry_run(v_admin, 'FULL', c_params, 'uat', false) ->> 'plan_id')::uuid;
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_other_plan, 'FULL FACTORY RESET UAT', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'MODE_NOT_ENABLED');
  perform pg_temp.chk('a new dry run expires the previous plan of the same user', (select status from public.system_reset_plans where id = v_plan_id) = 'EXPIRED');
  v_plan_id := (public.system_reset_dry_run(v_admin, 'OPERATIONAL', c_params, 'uat', false) ->> 'plan_id')::uuid;

  -- expired plan
  update public.system_reset_plans set expires_at = now() - interval '1 minute' where id = v_plan_id;
  perform pg_temp.expect_err(format('select public.system_reset_arm(%L,%L,%L,true,%L,%L,%L,%L,false)', v_admin, v_plan_id, 'RESET NIL OFFICE', 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat'), 'RESET_PLAN_EXPIRED');
  v_plan_id := (public.system_reset_dry_run(v_admin, 'OPERATIONAL', c_params, 'uat', false) ->> 'plan_id')::uuid;

  -- 8) arm OK -> begin gates -----------------------------------------------------------------------------------------------------------------
  v_token := public.system_reset_arm(v_admin, v_plan_id, 'RESET NIL OFFICE', true, 'bk-123456', v_ts, 'CONFIRMED_BY_ADMIN', 'uat', false);
  perform pg_temp.chk('token is long and random', length(v_token) = 64);
  perform pg_temp.chk('the token itself is never stored', not exists (select 1 from public.system_reset_plans p where p.token_hash = v_token) and
                      (select token_hash from public.system_reset_plans where id = v_plan_id) is not null);
  perform pg_temp.expect_err(format('select public.system_reset_begin(%L,%L,%L,%L,false)', v_admin, v_plan_id, 'wrong-token', 'uat'), 'RESET_CONFIRMATION_INVALID');
  perform pg_temp.expect_err(format('select public.system_reset_begin(%L,%L,%L,%L,false)', v_admin, v_plan_id, v_token, 'production'), 'RESET_PRODUCTION_BLOCKED');
  perform pg_temp.expect_err(format('select public.system_reset_begin(%L,%L,%L,%L,false)', v_admin, v_plan_id, v_token, 'development'), 'RESET_PLAN_STALE');
  update public.system_reset_manifest set reset_order = reset_order + 1 where object_name = 'tasks';                    -- the manifest changes after the review
  perform pg_temp.expect_err(format('select public.system_reset_begin(%L,%L,%L,%L,false)', v_admin, v_plan_id, v_token, 'uat'), 'RESET_PLAN_STALE');
  update public.system_reset_manifest set reset_order = reset_order - 1 where object_name = 'tasks';
  v_run := public.system_reset_begin(v_admin, v_plan_id, v_token, 'uat', false);
  perform pg_temp.chk('begin: plan consumed, run RUNNING / PREPARED, lock ON',
    (select status from public.system_reset_plans where id = v_plan_id) = 'USED'
    and exists (select 1 from public.system_reset_runs r where r.id = v_run and r.status = 'RUNNING' and r.phase = 'PREPARED' and r.initiated_by = v_admin)
    and (public.system_maintenance_status() ->> 'locked')::boolean);
  perform pg_temp.expect_err(format('select public.system_reset_begin(%L,%L,%L,%L,false)', v_admin, v_plan_id, v_token, 'uat'), 'RESET_PLAN_INVALID');   -- double click / retry
  perform pg_temp.chk('begin is audited', exists (select 1 from public.activity_logs where entity_type = 'system_reset' and entity_id = v_run and action = 'FACTORY_RESET_STARTED'));

  -- 9) execute refusal paths (all refused BEFORE any lock or truncate) -------------------------------------------------------------------------
  select (select count(*) from public.correspondence) + (select count(*) from public.journal_entries) + (select count(*) from public.companies) into v_before;
  perform pg_temp.expect_err(format('select public.system_reset_execute_db(%L,%L,%L,false)', v_admin, v_run, 'production'), 'RESET_PRODUCTION_BLOCKED');
  perform pg_temp.expect_err(format('select public.system_reset_execute_db(%L,%L,%L,false)', v_admin, v_run, 'development'), 'RESET_PLAN_STALE');
  perform pg_temp.expect_err(format('select public.system_reset_execute_db(%L,%L,%L,false)', gen_random_uuid(), v_run, 'uat'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.system_reset_execute_db(%L,%L,%L,false)', v_admin, gen_random_uuid(), 'uat'), 'RESET_PLAN_INVALID');
  select (select count(*) from public.correspondence) + (select count(*) from public.journal_entries) + (select count(*) from public.companies) into v_after;
  perform pg_temp.chk('refused executions deleted nothing', v_before = v_after);

  -- a failure releases the lock and records where it stopped
  perform public.system_reset_fail(v_admin, v_run, 'DB_RESET_STARTED', 'integrity test');
  perform pg_temp.chk('fail: run FAILED, lock released, event recorded',
    exists (select 1 from public.system_reset_runs r where r.id = v_run and r.status = 'FAILED')
    and not (public.system_maintenance_status() ->> 'locked')::boolean
    and exists (select 1 from public.system_reset_run_events e where e.run_id = v_run and not e.ok));

  -- 10) storage classification: branding never selected, unknown never deleted -----------------------------------------------------------
  insert into storage.objects (bucket_id, name) values
    ('nil-files', 'settings/letterhead-test.png'), ('nil-files', 'signatures/sig-test.png'), ('nil-files', 'correspondence/x/letter-test.pdf'),
    ('nil-files', 'payslips/p/x-test.pdf'), ('nil-files', 'weird/unknown-test.bin'), ('nil-files', s_lh);
  update public.app_settings set letterhead_path = s_lh where id = 1;                                                       -- a business-looking path that IS the live letterhead
  perform pg_temp.chk('settings/ preserved', (select action from public._srs_storage_classify() where path = 'settings/letterhead-test.png') = 'PRESERVE');
  perform pg_temp.chk('signatures/ preserved', (select action from public._srs_storage_classify() where path = 'signatures/sig-test.png') = 'PRESERVE');
  perform pg_temp.chk('business prefixes deleted', (select action from public._srs_storage_classify() where path = 'correspondence/x/letter-test.pdf') = 'DELETE'
                      and (select action from public._srs_storage_classify() where path = 'payslips/p/x-test.pdf') = 'DELETE');
  perform pg_temp.chk('unknown prefixes are only reported', (select action from public._srs_storage_classify() where path = 'weird/unknown-test.bin') = 'UNKNOWN');
  perform pg_temp.chk('the path of the live letterhead is preserved even under a business prefix', (select action from public._srs_storage_classify() where path = s_lh) = 'PRESERVE');
  perform pg_temp.chk('scan reports unknown objects', (public.system_reset_storage_scan() ->> 'unknown')::int >= 1);

  raise notice 'PASS: factory_reset_integrity (rolled back)';
end $$;

rollback;

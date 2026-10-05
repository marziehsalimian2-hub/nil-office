-- =====================================================================
-- NIL Office — 0142_factory_reset_safeupdate_fix.sql
-- Fix for 0141: Supabase loads pg-safeupdate for API calls, which rejects any UPDATE / DELETE without a WHERE clause
-- ("UPDATE requires a WHERE clause"). system_reset_execute_db reset accounting_sequences with a bare UPDATE, so the DB phase aborted
-- (the single transaction rolled back — NOTHING had been deleted). Same function, only that statement now has a WHERE.
-- Restated from the CURRENT body (0141 only). Signature unchanged => grants (service_role only) stay.
-- =====================================================================

create or replace function public.system_reset_execute_db(
  p_user uuid, p_run uuid, p_environment text, p_allow_production boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  v_run public.system_reset_runs; v_plan public.system_reset_plans; v_set text[]; v_lock_list text; v_trunc text;
  v_before jsonb := '{}'::jsonb; v_after_total bigint := 0; v_name text; v_n bigint; v_types text[]; v_year integer; v_base jsonb;
  v_audit_deleted bigint; v_items bigint; v_deleted jsonb := '{}'::jsonb; v_t0 timestamptz := now(); v_tpl_kept bigint;
begin
  perform public._srs_require_permission(p_user);                              -- second permission check, immediately before execution
  perform public._srs_env_guard(p_environment, p_allow_production);
  perform set_config('lock_timeout', '30s', true);
  perform set_config('statement_timeout', '300s', true);

  select * into v_run from public.system_reset_runs where id = p_run for update;
  if not found or v_run.initiated_by is distinct from p_user then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_run.phase = 'DB_RESET_COMPLETED' or v_run.phase in ('STORAGE_CLEANUP_STARTED', 'STORAGE_CLEANUP_COMPLETED', 'VERIFICATION', 'COMPLETED') then
    return jsonb_build_object('already_done', true, 'phase', v_run.phase);   -- idempotent: the DB phase is never run twice
  end if;
  if v_run.status <> 'RUNNING' or v_run.phase <> 'PREPARED' or v_run.mode <> 'OPERATIONAL' then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_run.environment is distinct from p_environment then raise exception 'RESET_PLAN_STALE' using errcode = '22000'; end if;
  if not exists (select 1 from public.system_maintenance where id = 1 and locked and reset_id = p_run) then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  select * into v_plan from public.system_reset_plans where id = v_run.plan_id;
  if v_plan.manifest_hash is distinct from public.system_reset_manifest_hash() or v_plan.schema_hash is distinct from public.system_reset_schema_hash() then
    raise exception 'RESET_PLAN_STALE' using errcode = '22000';
  end if;
  if coalesce(array_length(public.system_reset_unknown_tables(), 1), 0) > 0 or jsonb_array_length(public.system_reset_fk_blockers('OPERATIONAL')) > 0
     or coalesce(array_length(public.system_reset_missing_objects(), 1), 0) > 0 then
    raise exception 'RESET_NOT_EXECUTABLE' using errcode = '22000';
  end if;

  v_set := public._srs_set('OPERATIONAL');
  v_types := public._srs_audit_types('OPERATIONAL');
  v_year := (v_plan.params ->> 'current_year')::integer;
  v_base := coalesce(v_plan.params -> 'baselines', '{}'::jsonb);

  update public.system_reset_runs set phase = 'DB_RESET_STARTED' where id = p_run;

  -- block every concurrent writer for the rest of this transaction
  select string_agg(format('public.%I', t), ', ') into v_lock_list
    from unnest(v_set || array['activity_logs', 'number_sequences', 'accounting_sequences']) t;
  execute 'lock table ' || v_lock_list || ' in access exclusive mode';

  -- counts before (authoritative: under the lock)
  foreach v_name in array v_set loop
    v_n := public._srs_count(v_name);
    v_before := v_before || jsonb_build_object(v_name, v_n);
  end loop;
  for v_name in select m.object_name from public.system_reset_manifest m where m.mode_a in ('PRESERVE', 'RESET_VALUE', 'FILTERED_DELETE') loop
    v_before := v_before || jsonb_build_object('preserve:' || v_name, public._srs_count(v_name));
  end loop;
  select count(*) into v_tpl_kept from public.client_service_report_templates where scope = 'GLOBAL';
  v_before := v_before || jsonb_build_object('_templates_global', v_tpl_kept,
                                             '_policies', (select count(*) from pg_policies where schemaname in ('public', 'storage')),
                                             '_fk_not_validated', (select count(*) from pg_constraint where contype = 'f' and not convalidated),
                                             '_admins', (select count(*) from public.profiles where is_active and role = 'ADMIN'));

  -- storage cleanup list is decided HERE, from the server-side classification, before any record disappears
  insert into public.system_reset_storage_items (run_id, path, reason)
  select p_run, c.path, c.reason from public._srs_storage_classify() c where c.action = 'DELETE'
  on conflict (run_id, path) do nothing;
  get diagnostics v_items = row_count;

  -- keep-rows of the one partially preserved table (its FK to companies forces it into the same TRUNCATE)
  create temp table _srs_keep_templates on commit drop as select * from public.client_service_report_templates where scope = 'GLOBAL';

  -- ONE statement, no CASCADE: Postgres refuses it unless every FK-related table is in the list (checked above too)
  select 'truncate table ' || string_agg(format('public.%I', t), ', ') into v_trunc from unnest(v_set) t;
  execute v_trunc;

  insert into public.client_service_report_templates select * from _srs_keep_templates;
  delete from public.activity_logs where entity_type = 'client_service_report_templates' and created_at = v_t0;   -- noise of the restore insert only

  -- audit: business-entity rows only; security / system / config rows and the reset's own events stay
  delete from public.activity_logs where entity_type = any (v_types);
  get diagnostics v_audit_deleted = row_count;

  -- numbering: current Jalali year -> configured baselines, every other year -> 0, journal counters -> 0
  update public.number_sequences set last_value = 0, updated_at = now() where year <> v_year;
  update public.number_sequences s
     set last_value = coalesce((v_base ->> s.scope)::integer, 0), updated_at = now() where s.year = v_year;
  insert into public.number_sequences (scope, year, last_value)
  select b.key, v_year, (b.value #>> '{}')::integer from jsonb_each(v_base) b
   where not exists (select 1 from public.number_sequences s where s.scope = b.key and s.year = v_year);
  update public.accounting_sequences set last_value = 0, updated_at = now() where last_value >= 0;   -- (a WHERE is mandatory: Supabase's pg-safeupdate refuses an UPDATE without one)

  -- in-transaction postcheck: every truncated table is empty, otherwise the whole thing rolls back
  foreach v_name in array v_set loop
    v_n := public._srs_count(v_name);
    if v_name <> 'client_service_report_templates' then
      v_after_total := v_after_total + coalesce(v_n, 0);
    end if;
    v_deleted := v_deleted || jsonb_build_object(v_name, coalesce((v_before ->> v_name)::bigint, 0) - case when v_name = 'client_service_report_templates' then v_tpl_kept else 0 end);
  end loop;
  if v_after_total <> 0 then raise exception 'RESET_POSTCHECK_FAILED' using errcode = '22000'; end if;

  update public.system_reset_runs
     set phase = 'DB_RESET_COMPLETED', counts_before = v_before,
         counts_deleted = v_deleted || jsonb_build_object('_audit_rows', v_audit_deleted, '_storage_items', v_items)
   where id = p_run;
  insert into public.system_reset_run_events (run_id, phase, detail)
  values (p_run, 'DB_RESET_COMPLETED', jsonb_build_object('tables', coalesce(array_length(v_set, 1), 0), 'audit_rows_deleted', v_audit_deleted, 'storage_items', v_items));
  perform public.write_log('system_reset', p_run, 'FACTORY_RESET_DB_COMPLETED', null,
    jsonb_build_object('tables', coalesce(array_length(v_set, 1), 0), 'audit_rows_deleted', v_audit_deleted, 'storage_items', v_items));
  return jsonb_build_object('phase', 'DB_RESET_COMPLETED', 'tables', coalesce(array_length(v_set, 1), 0), 'audit_rows_deleted', v_audit_deleted, 'storage_items', v_items);
end; $$;

-- =====================================================================
-- ROLLBACK: re-run 0141's system_reset_execute_db (which has the bare UPDATE — do not).
-- =====================================================================

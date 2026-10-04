-- =============================================================================
-- NIL Office — HR & Payroll Phase 2 (configuration layer) integrity tests.
--
-- Run in the Supabase SQL editor AFTER migrations 0107-0117 and with at
-- least one active ADMIN profile. Runs in ONE transaction and ROLLS BACK
-- at the end (leaves nothing behind). NOT RUN by Claude — no live DB is
-- reachable from the sandbox; the user runs this by hand (same convention
-- as cheque_integrity.sql). The script temporarily re-roles the first
-- ADMIN profile to act as different personas (rolled back with everything
-- else) — do NOT run it while that admin is actively using the app.
--
-- Proves: tables start EMPTY (no seeded legal values); an HR-only persona
-- reads nothing salary/bank/rule related, directly or via activity_logs;
-- no salary/rate/bank value ever reaches activity_logs; payroll CREATE
-- cannot approve rule sets or see bank data; DRAFT rule entries are
-- editable and APPROVED ones frozen; overlapping approved sets are
-- rejected; closed compensation versions are immutable, a second open
-- version / delete / line edit is rejected; a later component version does
-- not change a pinned compensation line; direct writes by authenticated
-- fail.
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_hr text, p_payroll text) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles
     set role = p_role::app_role, hr_role = p_hr::hr_role, payroll_role = p_payroll::payroll_role
   where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set role authenticated';
end $$;

create function pg_temp.expect_err(p_sql text, p_code text) returns void
language plpgsql as $$
declare m text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics m = message_text;
    if position(p_code in m) = 0 then
      raise exception 'FAIL: expected %, got: %', p_code, m;
    end if;
    return;
  end;
  raise exception 'FAIL: no error raised, expected %', p_code;
end $$;

do $$
declare
  v_admin uuid;
  v_person uuid;
  v_comp uuid; v_ver uuid;
  v_set uuid; v_set2 uuid;
  v_profile1 uuid; v_profile2 uuid;
  v_dest uuid;
  v_cnt int;
  v_iban text := 'IR' || '062960000000100324200001';  -- synthetic, format only
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  -- 0) nothing seeded -----------------------------------------------------------
  select count(*) into v_cnt from (
    select 1 from public.legal_rule_sets union all select 1 from public.legal_rule_entries
    union all select 1 from public.salary_components union all select 1 from public.salary_component_versions
    union all select 1 from public.compensation_profiles union all select 1 from public.personnel_payment_destinations) t;
  if v_cnt <> 0 then raise exception 'FAIL(0): payroll config tables must start empty, found % rows', v_cnt; end if;
  select count(*) into v_cnt from public.legal_rule_set_transitions;
  if v_cnt <> 6 then raise exception 'FAIL(0): expected 6 transition rows, got %', v_cnt; end if;

  -- 1) ADMIN creates fixtures -----------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_person := (public.onboard_personnel('تست', 'پرداخت', current_date - 400, 'کارشناس', 'FULL_TIME')).id;
  v_ver := (public.create_salary_component('HOUSING_ALLOWANCE', 'EARNING', 'حق مسکن', 'FIXED', current_date - 365,
             null, 111111.1111, 'IRR')).id;
  select component_id into v_comp from public.salary_component_versions where id = v_ver;
  v_profile1 := (public.create_compensation_version(v_person, current_date - 300, 987654321.1234, 'IRR', 'MONTHLY',
                  null, null, jsonb_build_array(jsonb_build_object('component_id', v_comp)))).id;
  v_dest := (public.add_payment_destination(v_person, 'بانک تست', 'تست پرداخت', null, v_iban)).id;
  v_set := (public.create_legal_rule_set('قواعد تست', 'TEST-LAND', current_date - 100, null, 'مرجع تست')).id;
  perform public.upsert_legal_rule_entry(v_set, 'minimum_wage', 424242);

  -- 2) HR-only persona sees nothing ------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  select count(*) into v_cnt from (
    select 1 from public.legal_rule_sets union all select 1 from public.legal_rule_entries
    union all select 1 from public.salary_components union all select 1 from public.salary_component_versions
    union all select 1 from public.compensation_profiles union all select 1 from public.compensation_lines
    union all select 1 from public.personnel_payment_destinations) t;
  if v_cnt <> 0 then raise exception 'FAIL(2): HR-only persona read % payroll rows', v_cnt; end if;
  select count(*) into v_cnt from public.activity_logs
   where entity_type in ('salary_components','salary_component_versions','compensation_profiles','compensation_lines',
                         'personnel_payment_destinations','legal_rule_sets','legal_rule_entries');
  if v_cnt <> 0 then raise exception 'FAIL(2): HR-only persona read % payroll log rows', v_cnt; end if;
  perform pg_temp.expect_err(format('select public.create_salary_component(%L,%L,%L,%L,%L)', 'X_TEST','EARNING','x','MANUAL_INPUT', current_date), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.reveal_payment_destination(%L)', v_dest), 'NOT_AUTHORIZED');

  -- 3) no sensitive value in activity_logs (checked as superuser) ---------------------
  execute 'reset role';
  select count(*) into v_cnt from public.activity_logs
   where entity_type in ('salary_components','salary_component_versions','compensation_profiles','compensation_lines',
                         'personnel_payment_destinations','legal_rule_sets','legal_rule_entries')
     and (coalesce(old_value::text,'') || coalesce(new_value::text,'')) ~ '(987654321|111111|424242|062960000000100324200001)';
  if v_cnt <> 0 then raise exception 'FAIL(3): % activity_logs rows contain salary/rate/bank values', v_cnt; end if;

  -- 4) payroll CREATE tier: can write drafts, cannot approve or see bank -----------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.upsert_legal_rule_entry(v_set, 'insurance_ceiling', 1);
  perform pg_temp.expect_err(format('select public.change_legal_rule_set_status(%L,%L)', v_set, 'REVIEWED'), 'NOT_AUTHORIZED');
  select count(*) into v_cnt from public.personnel_payment_destinations;
  if v_cnt <> 0 then raise exception 'FAIL(4): CREATE tier read bank rows'; end if;
  perform pg_temp.expect_err(format('select public.add_payment_destination(%L,%L,%L,%L)', v_person, 'b', 'h', '12345'), 'NOT_AUTHORIZED');

  -- 5) APPROVE tier: DRAFT -> REVIEWED -> APPROVED, then frozen ----------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.change_legal_rule_set_status(v_set, 'REVIEWED');
  perform public.change_legal_rule_set_status(v_set, 'APPROVED');
  perform pg_temp.expect_err(format('select public.upsert_legal_rule_entry(%L,%L,%s)', v_set, 'minimum_wage', 1), 'RULE_SET_NOT_DRAFT');
  perform pg_temp.expect_err(format('select public.change_legal_rule_set_status(%L,%L,%L)', v_set, 'RETIRED', 'x'), 'NOT_AUTHORIZED');

  -- 6) overlapping APPROVED set with the same key is rejected -------------------------------
  v_set2 := (public.create_legal_rule_set('قواعد تست ۲', 'TEST-LAND', current_date - 50, null, null)).id;
  perform public.upsert_legal_rule_entry(v_set2, 'minimum_wage', 2);
  perform public.change_legal_rule_set_status(v_set2, 'REVIEWED');
  perform pg_temp.expect_err(format('select public.change_legal_rule_set_status(%L,%L)', v_set2, 'APPROVED'), 'RULE_SET_OVERLAP');

  -- 7) compensation versioning / immutability ------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_profile2 := (public.create_compensation_version(v_person, current_date - 100, 1000, 'IRR', 'MONTHLY')).id;
  execute 'reset role';
  perform pg_temp.expect_err(format('update public.compensation_profiles set base_salary = 1 where id = %L', v_profile1), 'PAYROLL_VERSION_CLOSED_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.compensation_profiles set base_salary = 1 where id = %L', v_profile2), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('delete from public.compensation_profiles where id = %L', v_profile2), 'PAYROLL_NO_DELETE');
  perform pg_temp.expect_err(format('update public.compensation_lines set notes = %L where compensation_profile_id = %L', 'x', v_profile1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(
    format('insert into public.compensation_profiles (personnel_id, version_number, effective_from, base_salary, currency, payment_frequency, created_by) values (%L, 99, current_date, 1, %L, %L, %L)',
           v_person, 'IRR', 'MONTHLY', v_admin), 'uq_compensation_one_open');

  -- 8) validation errors -----------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform pg_temp.expect_err(format('select public.create_compensation_version(%L,%L,1,%L,%L)', v_person, current_date - 200, 'IRR', 'MONTHLY'), 'PAYROLL_START_BEFORE_CURRENT');
  perform pg_temp.expect_err(format('select public.create_compensation_version(%L,current_date,1,%L,%L)', v_person, 'XYZ', 'MONTHLY'), 'INVALID_CURRENCY');
  perform pg_temp.expect_err(format('select public.create_compensation_version(%L,current_date,1,%L,%L)', v_person, 'IRR', 'HOURLY'), 'HOURLY_RATE_REQUIRED');

  -- 9) a later component version never changes a pinned line ---------------------------------------
  perform public.create_salary_component_version(v_comp, 'حق مسکن v2', 'FIXED', current_date - 10, null, 222222, 'IRR');
  select count(*) into v_cnt from public.compensation_lines l
    join public.salary_component_versions cv on cv.id = l.component_version_id
   where l.compensation_profile_id = v_profile1 and cv.version_number = 1 and cv.fixed_amount = 111111.1111;
  if v_cnt <> 1 then raise exception 'FAIL(9): pinned compensation line no longer points at component v1'; end if;

  -- 10) direct writes by authenticated are impossible ----------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform pg_temp.expect_err(
    format('insert into public.salary_components (code, component_type, created_by) values (%L,%L,%L)', 'DIRECT_X', 'EARNING', v_admin),
    'permission denied');

  execute 'reset role';
  raise notice 'PASS: payroll configuration layer integrity checks';
end $$;

rollback;

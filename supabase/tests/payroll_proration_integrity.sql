-- =============================================================================
-- NIL Office — HR & Payroll Phase 9 (calendar-day proration of a partial month, PAYROLL_ENGINE_3) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0140, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything is SYNTHETIC (period 1450/01 = 2071-03-21 .. 2071-04-20,
-- 31 days; every amount exists only inside the rollback). Real personnel are EXCLUDED from the fixture batch through eligibility
-- overrides; every assertion looks only at the fixture personnel ids.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Hand-computed (HALF_UP, scale 0, period_days = 31, base salary 31,000,000 unless stated):
--   A  full month (31/31)         base 31,000,000  tick 1,550,000  full 1,000,000  7%-of-base 2,170,000  manual 200,000
--                                  overtime 10 h = 10 x 31,000,000 x 1.4 / 220 = 1,972,727.27 -> 1,972,727
--                                  gross 37,892,727   ins 10% of gross 3,789,273   absence 3 d = 3 x 31,000,000 / 30 = 3,100,000
--                                  ded 6,889,273   net 31,003,454      (exactly the pre-Phase-9 numbers: no proration, no trace)
--   B  hired 04-11 (10/31)        base 10,000,000  tick 500,000  full 1,000,000 (NOT ticked)  7%-of-base 700,000 (follows the prorated base)
--                                  manual 200,000 (never prorated)  overtime 1,972,727 and absence 3,100,000 on the FULL base (never prorated)
--                                  gross 14,372,727   ins 10% = 1,437,273   ded 4,537,273   net 9,835,454
--   C  terminated 04-06 (16/31)   base 16,000,000  tick 800,000  7% 1,120,000  gross = net 17,920,000
--   D  terminated 03-31, rehired 04-11 (10 + 10 = 20/31, a GAP between two records)
--                                  base 20,000,000  ticked line with a per-person override 3,100,000 -> 2,000,000  gross 22,000,000
--   E  ended before the period but INCLUDE-forced (0/31)  -> NOT prorated (full 31,000,000) + WARNING PRORATION_NOT_APPLIED
--   F  hired 04-14 (7/31), base 10,000,000: 10,000,000 x 7 / 31 = 2,258,064.52 -> 2,258,065 (ONE division, ONE rounding)
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_hr text, p_payroll text) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles set role = p_role::app_role, hr_role = p_hr::hr_role, payroll_role = p_payroll::payroll_role where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set role authenticated';
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

create function pg_temp.chk(p_label text, p_actual numeric, p_expected numeric) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FAIL(%): expected %, got %', p_label, p_expected, p_actual; end if;
end $$;

create function pg_temp.line_amt(p_calc uuid, p_person uuid, p_code text) returns numeric language sql as $$
  select l.amount from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id
   where r.calculation_id = p_calc and r.personnel_id = p_person and l.component_code = p_code $$;
create function pg_temp.line(p_calc uuid, p_person uuid, p_code text) returns public.payroll_result_lines language sql as $$
  select l.* from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id
   where r.calculation_id = p_calc and r.personnel_id = p_person and l.component_code = p_code $$;
create function pg_temp.tot(p_calc uuid, p_person uuid, p_col text) returns numeric language sql as $$
  select case p_col when 'gross' then r.gross when 'ded' then r.total_deductions when 'net' then r.net end
    from public.payroll_results r where r.calculation_id = p_calc and r.personnel_id = p_person $$;
create function pg_temp.complete(p_calc uuid, p_person uuid) returns boolean language sql as $$
  select r.is_complete from public.payroll_results r where r.calculation_id = p_calc and r.personnel_id = p_person $$;
create function pg_temp.warn(p_calc uuid, p_person uuid, p_code text, p_sev text) returns boolean language sql as $$
  select exists (select 1 from public.payroll_calc_warnings w where w.calculation_id = p_calc
                  and w.personnel_id is not distinct from p_person and w.code = p_code and w.severity = p_sev) $$;
create function pg_temp.inputs(p_calc uuid, p_person uuid) returns jsonb language sql as $$
  select r.inputs from public.payroll_results r where r.calculation_id = p_calc and r.personnel_id = p_person $$;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_ids uuid[]; v_others uuid[]; v_o uuid;
  c_tick uuid; c_full uuid; c_pct uuid; c_man uuid; c_ins uuid; c_ot uuid; c_abs uuid;
  v_period uuid; v_batch uuid; v_c1 uuid; v_ra uuid; v_rb uuid; v_l public.payroll_result_lines; v_j jsonb; v_ver public.salary_component_versions;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  update public.app_settings set base_currency_code = 'IRR' where id = 1;

  -- 1) fixtures: personnel with real employment-record histories ------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست۹', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست۹',   date '2071-04-11', 'کارشناس', 'FULL_TIME')).id;   -- hired mid-period
  v_c := (public.onboard_personnel('ج', 'تست۹',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- terminated mid-period
  v_d := (public.onboard_personnel('د', 'تست۹',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- terminated, then rehired (a gap)
  v_e := (public.onboard_personnel('ه', 'تست۹',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- ended before the period, INCLUDE-forced
  v_f := (public.onboard_personnel('و', 'تست۹',   date '2071-04-14', 'کارشناس', 'FULL_TIME')).id;   -- hired mid-period, rounding case
  v_ids := array[v_a, v_b, v_c, v_d, v_e, v_f];
  perform public.change_personnel_status(v_c, 'TERMINATED', 'test', date '2071-04-06');
  perform public.change_personnel_status(v_d, 'TERMINATED', 'test', date '2071-03-31');
  perform public.change_personnel_status(v_d, 'ACTIVE', 'rehire', date '2071-04-11', 'FULL_TIME', 'کارشناس');
  perform public.change_personnel_status(v_e, 'TERMINATED', 'test', date '2071-03-01');

  -- components. Numbers are plain amounts on the component; NO legal rule is involved.
  c_tick := (public.create_salary_component(p_code => 'TICK_P9T', p_component_type => 'EARNING', p_name_fa => 'مزایای متناسب',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1550000, p_currency => 'IRR',
              p_prorate_on_partial_period => true)).component_id;
  c_full := (public.create_salary_component(p_code => 'FULL_P9T', p_component_type => 'EARNING', p_name_fa => 'مزایای کامل',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000, p_currency => 'IRR')).component_id;
  c_pct := (public.create_salary_component(p_code => 'PCT_P9T', p_component_type => 'EARNING', p_name_fa => 'درصد از پایه',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage => 7, p_percentage_basis => 'BASE_SALARY')).component_id;
  c_man := (public.create_salary_component(p_code => 'MAN_P9T', p_component_type => 'EARNING', p_name_fa => 'پاداش دستی',
              p_calculation_method => 'MANUAL_INPUT', p_effective_from => date '2000-01-01')).component_id;
  c_ins := (public.create_salary_component(p_code => 'INS_P9T', p_component_type => 'DEDUCTION', p_name_fa => 'بیمه',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage => 10, p_percentage_basis => 'GROSS_EARNINGS')).component_id;
  c_ot := (public.create_salary_component(p_code => 'OT_P9T', p_component_type => 'EARNING', p_name_fa => 'اضافه‌کاری',
              p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
              p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 220, p_rate_multiplier => 1.4)).component_id;
  c_abs := (public.create_salary_component(p_code => 'ABS_P9T', p_component_type => 'DEDUCTION', p_name_fa => 'کسر غیبت',
              p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
              p_quantity_source => 'ABSENCE_DAYS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 30, p_rate_multiplier => 1)).component_id;

  -- 2) the tick: stored on a FIXED version only, defaults off, frozen with the version ----------------------------------------------------
  select * into v_ver from public.salary_component_versions where component_id = c_tick;
  if not v_ver.prorate_on_partial_period then raise exception 'FAIL(2): the tick was not stored'; end if;
  select * into v_ver from public.salary_component_versions where component_id = c_full;
  if v_ver.prorate_on_partial_period then raise exception 'FAIL(2): the tick must default to off'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X1_P9T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage => 5, p_percentage_basis => 'BASE_SALARY', p_prorate_on_partial_period => true)$q$, 'COMPONENT_INVALID_COMBINATION');
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X2_P9T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'MANUAL_INPUT', p_effective_from => date '2000-01-01', p_prorate_on_partial_period => true)$q$, 'COMPONENT_INVALID_COMBINATION');
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X3_P9T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 220, p_rate_multiplier => 1.4, p_prorate_on_partial_period => true)$q$, 'COMPONENT_INVALID_COMBINATION');
  -- a new version may flip the tick (versions are append-only); an existing version may not be edited
  perform public.create_salary_component_version(c_full, 'مزایای کامل', 'FIXED', date '2001-01-01', p_fixed_amount => 1000000, p_currency => 'IRR');
  if (select prorate_on_partial_period from public.salary_component_versions where component_id = c_full and effective_to is null) then
    raise exception 'FAIL(2): a new version without the tick must not carry it';
  end if;
  execute 'reset role';
  perform pg_temp.expect_err(format($q$update public.salary_component_versions set prorate_on_partial_period = false where component_id = %L$q$, c_tick), 'PAYROLL_VERSION_FIELD_IMMUTABLE');

  -- 3) compensation, work data ---------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform public.create_compensation_version(v_a, date '2070-01-01', 31000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_tick), jsonb_build_object('component_id', c_full), jsonb_build_object('component_id', c_pct),
    jsonb_build_object('component_id', c_man), jsonb_build_object('component_id', c_ins), jsonb_build_object('component_id', c_ot), jsonb_build_object('component_id', c_abs)));
  perform public.create_compensation_version(v_b, date '2071-04-11', 31000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_tick), jsonb_build_object('component_id', c_full), jsonb_build_object('component_id', c_pct),
    jsonb_build_object('component_id', c_man), jsonb_build_object('component_id', c_ins), jsonb_build_object('component_id', c_ot), jsonb_build_object('component_id', c_abs)));
  perform public.create_compensation_version(v_c, date '2070-01-01', 31000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_tick), jsonb_build_object('component_id', c_pct)));
  perform public.create_compensation_version(v_d, date '2070-01-01', 31000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_tick, 'amount_override', '3100000')));                               -- per-person override of a ticked amount
  perform public.create_compensation_version(v_e, date '2070-01-01', 31000000, 'IRR', 'MONTHLY');
  perform public.create_compensation_version(v_f, date '2071-04-14', 10000000, 'IRR', 'MONTHLY');

  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;
  perform public.save_payroll_work_data(v_period, v_a, p_overtime_hours => 10, p_absence_days => 3,
    p_inputs => jsonb_build_array(jsonb_build_object('component_id', c_man, 'amount', '200000', 'currency', 'IRR')));
  perform public.save_payroll_work_data(v_period, v_b, p_overtime_hours => 10, p_absence_days => 3,
    p_inputs => jsonb_build_array(jsonb_build_object('component_id', c_man, 'amount', '200000', 'currency', 'IRR')));

  -- 4) batch (real personnel excluded, E forced in), calculation + approval ----------------------------------------------------------
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', null)).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_batch, v_o, 'EXCLUDE', 'phase9 test fixture isolation');
  end loop;
  perform public.set_payroll_eligibility_override(v_batch, v_e, 'INCLUDE', 'phase9 test: no employment days');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_c1 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  if (select engine_version from public.payroll_calculations where id = v_c1) <> 'PAYROLL_ENGINE_3' then raise exception 'FAIL(4): engine version'; end if;

  -- A: full month — exactly the pre-Phase-9 numbers, no proration trace anywhere
  perform pg_temp.chk('A base',  pg_temp.line_amt(v_c1, v_a, 'BASE_SALARY'), 31000000);
  perform pg_temp.chk('A tick',  pg_temp.line_amt(v_c1, v_a, 'TICK_P9T'),  1550000);
  perform pg_temp.chk('A full',  pg_temp.line_amt(v_c1, v_a, 'FULL_P9T'),  1000000);
  perform pg_temp.chk('A pct',   pg_temp.line_amt(v_c1, v_a, 'PCT_P9T'),   2170000);
  perform pg_temp.chk('A man',   pg_temp.line_amt(v_c1, v_a, 'MAN_P9T'),   200000);
  perform pg_temp.chk('A ot',    pg_temp.line_amt(v_c1, v_a, 'OT_P9T'),    1972727);
  perform pg_temp.chk('A ins',   pg_temp.line_amt(v_c1, v_a, 'INS_P9T'),   3789273);
  perform pg_temp.chk('A abs',   pg_temp.line_amt(v_c1, v_a, 'ABS_P9T'),   3100000);
  perform pg_temp.chk('A gross', pg_temp.tot(v_c1, v_a, 'gross'), 37892727);
  perform pg_temp.chk('A ded',   pg_temp.tot(v_c1, v_a, 'ded'),   6889273);
  perform pg_temp.chk('A net',   pg_temp.tot(v_c1, v_a, 'net'),   31003454);
  if pg_temp.warn(v_c1, v_a, 'PARTIAL_PERIOD', 'WARNING') or pg_temp.warn(v_c1, v_a, 'PRORATION_NOT_APPLIED', 'WARNING') then raise exception 'FAIL(4): A is a full month'; end if;
  if exists (select 1 from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id
              where r.calculation_id = v_c1 and r.personnel_id = v_a and l.details ? 'proration') then raise exception 'FAIL(4): a full month carries no line trace'; end if;
  if (pg_temp.inputs(v_c1, v_a) -> 'proration' ->> 'applied')::boolean or (pg_temp.inputs(v_c1, v_a) -> 'proration' ->> 'employed_days')::int <> 31 then
    raise exception 'FAIL(4): A person trace (%)', pg_temp.inputs(v_c1, v_a) -> 'proration';
  end if;

  -- B: hired 04-11 = 10 of 31 days
  perform pg_temp.chk('B base',  pg_temp.line_amt(v_c1, v_b, 'BASE_SALARY'), 10000000);
  perform pg_temp.chk('B tick (ticked FIXED is prorated)', pg_temp.line_amt(v_c1, v_b, 'TICK_P9T'), 500000);
  perform pg_temp.chk('B full (NOT ticked: paid in full)', pg_temp.line_amt(v_c1, v_b, 'FULL_P9T'), 1000000);
  perform pg_temp.chk('B pct (follows the prorated base)', pg_temp.line_amt(v_c1, v_b, 'PCT_P9T'), 700000);
  perform pg_temp.chk('B man (never prorated)', pg_temp.line_amt(v_c1, v_b, 'MAN_P9T'), 200000);
  perform pg_temp.chk('B ot (full-base wage)',  pg_temp.line_amt(v_c1, v_b, 'OT_P9T'),  1972727);
  perform pg_temp.chk('B abs (full-base wage)', pg_temp.line_amt(v_c1, v_b, 'ABS_P9T'), 3100000);
  perform pg_temp.chk('B ins (gross-based follows the prorated gross)', pg_temp.line_amt(v_c1, v_b, 'INS_P9T'), 1437273);
  perform pg_temp.chk('B gross', pg_temp.tot(v_c1, v_b, 'gross'), 14372727);
  perform pg_temp.chk('B ded',   pg_temp.tot(v_c1, v_b, 'ded'),   4537273);
  perform pg_temp.chk('B net',   pg_temp.tot(v_c1, v_b, 'net'),   9835454);
  if not pg_temp.complete(v_c1, v_b) then raise exception 'FAIL(4): B must be complete'; end if;
  if not pg_temp.warn(v_c1, v_b, 'PARTIAL_PERIOD', 'WARNING') then raise exception 'FAIL(4): B PARTIAL_PERIOD'; end if;
  if pg_temp.warn(v_c1, v_b, 'PRORATION_NOT_APPLIED', 'WARNING') then raise exception 'FAIL(4): B was prorated'; end if;
  v_l := pg_temp.line(v_c1, v_b, 'BASE_SALARY');
  if (v_l.details -> 'proration' ->> 'employed_days')::int <> 10 or (v_l.details -> 'proration' ->> 'period_days')::int <> 31 then raise exception 'FAIL(4): B base trace (%)', v_l.details; end if;
  v_l := pg_temp.line(v_c1, v_b, 'TICK_P9T');
  if (v_l.details -> 'proration' ->> 'employed_days')::int <> 10 then raise exception 'FAIL(4): B tick trace (%)', v_l.details; end if;
  if (pg_temp.line(v_c1, v_b, 'FULL_P9T')).details is not null or (pg_temp.line(v_c1, v_b, 'PCT_P9T')).details is not null
     or (pg_temp.line(v_c1, v_b, 'MAN_P9T')).details is not null or (pg_temp.line(v_c1, v_b, 'OT_P9T')).details ? 'proration' then
    raise exception 'FAIL(4): only prorated lines carry the trace';
  end if;
  if not (pg_temp.inputs(v_c1, v_b) -> 'proration' ->> 'applied')::boolean or (pg_temp.inputs(v_c1, v_b) -> 'proration' ->> 'employed_days')::int <> 10 then
    raise exception 'FAIL(4): B person trace (%)', pg_temp.inputs(v_c1, v_b);
  end if;

  -- C: terminated 04-06 (the end date is the first day NOT employed) = 16 of 31 days
  perform pg_temp.chk('C base', pg_temp.line_amt(v_c1, v_c, 'BASE_SALARY'), 16000000);
  perform pg_temp.chk('C tick', pg_temp.line_amt(v_c1, v_c, 'TICK_P9T'),  800000);
  perform pg_temp.chk('C pct',  pg_temp.line_amt(v_c1, v_c, 'PCT_P9T'),   1120000);
  perform pg_temp.chk('C gross', pg_temp.tot(v_c1, v_c, 'gross'), 17920000);
  perform pg_temp.chk('C net',   pg_temp.tot(v_c1, v_c, 'net'),   17920000);
  if not pg_temp.warn(v_c1, v_c, 'PARTIAL_PERIOD', 'WARNING') then raise exception 'FAIL(4): C PARTIAL_PERIOD'; end if;

  -- D: two employment records with a gap (10 + 10 days); proration comes from the records, not from hire/termination dates
  perform pg_temp.chk('D base', pg_temp.line_amt(v_c1, v_d, 'BASE_SALARY'), 20000000);
  perform pg_temp.chk('D tick (per-person override 3,100,000 x 20/31)', pg_temp.line_amt(v_c1, v_d, 'TICK_P9T'), 2000000);
  perform pg_temp.chk('D gross', pg_temp.tot(v_c1, v_d, 'gross'), 22000000);
  if (pg_temp.inputs(v_c1, v_d) -> 'proration' ->> 'employed_days')::int <> 20 then raise exception 'FAIL(4): D employed days (%)', pg_temp.inputs(v_c1, v_d); end if;
  if not pg_temp.warn(v_c1, v_d, 'PARTIAL_PERIOD', 'WARNING') then raise exception 'FAIL(4): D PARTIAL_PERIOD'; end if;

  -- E: no employment day in the period but forced in: NOT prorated, never silently zeroed
  perform pg_temp.chk('E base', pg_temp.line_amt(v_c1, v_e, 'BASE_SALARY'), 31000000);
  perform pg_temp.chk('E gross', pg_temp.tot(v_c1, v_e, 'gross'), 31000000);
  if not pg_temp.warn(v_c1, v_e, 'PRORATION_NOT_APPLIED', 'WARNING') then raise exception 'FAIL(4): E PRORATION_NOT_APPLIED'; end if;
  if pg_temp.warn(v_c1, v_e, 'PARTIAL_PERIOD', 'WARNING') then raise exception 'FAIL(4): E was not prorated'; end if;
  if (pg_temp.line(v_c1, v_e, 'BASE_SALARY')).details is not null then raise exception 'FAIL(4): E carries no line trace'; end if;
  if (pg_temp.inputs(v_c1, v_e) -> 'proration' ->> 'employed_days')::int <> 0 or (pg_temp.inputs(v_c1, v_e) -> 'proration' ->> 'applied')::boolean then
    raise exception 'FAIL(4): E person trace (%)', pg_temp.inputs(v_c1, v_e);
  end if;

  -- F: one division, one rounding: 10,000,000 x 7 / 31 = 2,258,064.516 -> 2,258,065
  perform pg_temp.chk('F base', pg_temp.line_amt(v_c1, v_f, 'BASE_SALARY'), 2258065);
  perform pg_temp.chk('F gross', pg_temp.tot(v_c1, v_f, 'gross'), 2258065);

  -- 5) the approved result keeps the proration; payslip lines carry it only where it applies ---------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.change_payroll_batch_status(v_batch, 'UNDER_REVIEW');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.mark_payroll_batch_reviewed(v_batch);
  perform public.approve_payroll_batch(v_batch);
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_c1 and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_c1 and personnel_id = v_b;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  v_j := public.payroll_payslip_data(v_rb);
  if not exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ->> 'code' = 'BASE_SALARY'
                    and (l -> 'proration' ->> 'employed_days')::int = 10 and (l -> 'proration' ->> 'period_days')::int = 31) then
    raise exception 'FAIL(5): payslip base line must carry the proration (%)', v_j -> 'lines';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ->> 'code' = 'TICK_P9T' and l ? 'proration') then raise exception 'FAIL(5): payslip tick line'; end if;
  if exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ->> 'code' in ('FULL_P9T', 'PCT_P9T', 'MAN_P9T', 'OT_P9T', 'INS_P9T', 'ABS_P9T') and l ? 'proration') then
    raise exception 'FAIL(5): only prorated payslip lines carry the trace';
  end if;
  perform pg_temp.chk('B payslip net', (v_j -> 'totals' ->> 'net')::numeric, 9835454);
  v_j := public.payroll_payslip_data(v_ra);
  if exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ? 'proration') then raise exception 'FAIL(5): a full-month payslip carries no proration'; end if;
  perform pg_temp.chk('A payslip net', (v_j -> 'totals' ->> 'net')::numeric, 31003454);
  -- the result screen reads the same trace through payroll_result_detail
  v_j := public.payroll_result_detail(v_rb);
  if (v_j -> 'result' -> 'inputs' -> 'proration' ->> 'employed_days')::int <> 10
     or not exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ->> 'component_code' = 'BASE_SALARY' and (l -> 'details' -> 'proration' ->> 'period_days')::int = 31) then
    raise exception 'FAIL(5): result detail must expose the proration (%)', v_j -> 'result' -> 'inputs';
  end if;

  raise notice 'PASS: payroll_proration_integrity (rolled back)';
end $$;

rollback;

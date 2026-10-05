-- =============================================================================
-- NIL Office — HR & Payroll Phase 8 (QUANTITY_X_RATE: automatic overtime / absence calculation) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0138, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything is SYNTHETIC: jurisdiction 'TEST-P8', period 1450/01,
-- rule keys / values / amounts exist only inside the rollback. Real personnel are also eligible for that far-future period;
-- every assertion looks only at the fixture personnel ids.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Hand-computed (HALF_UP, scale 0, base 30,000,000 IRR):
--   overtime 10 h, divisor 220, x1.4 : 10 x 30,000,000 x 1.4 / 220 = 1,909,090.909 -> 1,909,091
--   absence 2 days, divisor 30, x1   : 2 x 30,000,000 / 30         = 2,000,000
--   mission 3 days PER_UNIT 500,000  : 1,500,000                      (override 700,000 x 2 days = 1,400,000)
--   profile hourly rate 150,000      : 10 x 150,000 x 1.4          = 2,100,000
--   A: gross 33,409,091  ins 7% = 2,338,636  ded 4,338,636  net 29,070,455
--   B: gross 33,500,000  ins 7% = 2,345,000  ded 2,345,000  net 31,155,000
--   C (rule-bound): gross 31,909,091  ded 2,000,000  net 29,909,091
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
create function pg_temp.line_status(p_calc uuid, p_person uuid, p_code text) returns text language sql as $$
  select l.status from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id
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

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_i uuid;
  c_ot uuid; c_abs uuid; c_miss uuid; c_ins uuid; c_ot_rule uuid; c_abs_rule uuid; c_ot_badunit uuid; c_ot_norule uuid; c_bad uuid;
  v_set uuid; v_period uuid; v_batch uuid; v_c1 uuid; v_c2 uuid; v_l public.payroll_result_lines; v_n integer;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  update public.app_settings set base_currency_code = 'IRR' where id = 1;

  -- 1) fixtures -------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_c := (public.onboard_personnel('ج', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_d := (public.onboard_personnel('د', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_e := (public.onboard_personnel('ه', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_f := (public.onboard_personnel('و', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_g := (public.onboard_personnel('ز', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_i := (public.onboard_personnel('ی', 'تست۸', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;

  -- the rule set: APPROVED, synthetic values, jurisdiction TEST-P8
  v_set := (public.create_legal_rule_set('قواعد فاز۸', 'TEST-P8', date '2000-01-01')).id;
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'ot_multiplier',  p_value_numeric => 1.4, p_unit => 'RATIO');
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'abs_multiplier', p_value_numeric => 1,   p_unit => 'RATIO');
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'ot_hours_basis', p_value_numeric => 220, p_unit => 'HOURS');
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'abs_days_basis', p_value_numeric => 30,  p_unit => 'DAYS');
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'bad_unit_div',   p_value_numeric => 30,  p_unit => 'DAYS');   -- DAYS used as an HOURS divisor
  perform public.change_legal_rule_set_status(v_set, 'REVIEWED');
  perform public.change_legal_rule_set_status(v_set, 'APPROVED');

  -- components: numbers on the component
  c_ot := (public.create_salary_component(p_code => 'OT_P8T', p_component_type => 'EARNING', p_name_fa => 'اضافه‌کاری',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 220, p_rate_multiplier => 1.4)).component_id;
  c_abs := (public.create_salary_component(p_code => 'ABS_P8T', p_component_type => 'DEDUCTION', p_name_fa => 'کسر غیبت',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'ABSENCE_DAYS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 30, p_rate_multiplier => 1)).component_id;
  c_miss := (public.create_salary_component(p_code => 'MISS_P8T', p_component_type => 'EARNING', p_name_fa => 'حق ماموریت',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'MISSION_DAYS', p_rate_mode => 'PER_UNIT', p_fixed_amount => 500000, p_currency => 'IRR')).component_id;
  c_ins := (public.create_salary_component(p_code => 'INS_P8T', p_component_type => 'DEDUCTION', p_name_fa => 'بیمه',
            p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage => 7, p_percentage_basis => 'GROSS_EARNINGS')).component_id;
  -- components: numbers from APPROVED rules
  c_ot_rule := (public.create_salary_component(p_code => 'OTR_P8T', p_component_type => 'EARNING', p_name_fa => 'اضافه‌کاری (قاعده)',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_divisor_rule_key => 'ot_hours_basis', p_multiplier_rule_key => 'ot_multiplier')).component_id;
  c_abs_rule := (public.create_salary_component(p_code => 'ABSR_P8T', p_component_type => 'DEDUCTION', p_name_fa => 'کسر غیبت (قاعده)',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'ABSENCE_DAYS', p_rate_mode => 'WAGE_FRACTION', p_divisor_rule_key => 'abs_days_basis', p_multiplier_rule_key => 'abs_multiplier')).component_id;
  c_ot_badunit := (public.create_salary_component(p_code => 'OTU_P8T', p_component_type => 'EARNING', p_name_fa => 'واحد نامعتبر',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_divisor_rule_key => 'bad_unit_div', p_multiplier_rule_key => 'ot_multiplier')).component_id;
  c_ot_norule := (public.create_salary_component(p_code => 'OTN_P8T', p_component_type => 'EARNING', p_name_fa => 'قاعدهٔ ناموجود',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_divisor_rule_key => 'no_such_rule', p_multiplier_rule_key => 'ot_multiplier')).component_id;
  c_bad := (public.create_salary_component(p_code => 'USD_P8T', p_component_type => 'EARNING', p_name_fa => 'ارز نامتناسب',
            p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01',
            p_quantity_source => 'MISSION_DAYS', p_rate_mode => 'PER_UNIT', p_fixed_amount => 10, p_currency => 'USD')).component_id;

  -- 2) configuration validation (write path) -----------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X1_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01')$q$, 'COMPONENT_INVALID_COMBINATION');                       -- no parameters at all
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X2_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 220, p_divisor_rule_key => 'k_one', p_rate_multiplier => 1.4)$q$, 'COMPONENT_INVALID_COMBINATION');   -- divisor given TWO ways
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X3_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 220)$q$, 'COMPONENT_INVALID_COMBINATION');                         -- no multiplier
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X4_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'MISSION_DAYS', p_rate_mode => 'PER_UNIT', p_currency => 'IRR')$q$, 'COMPONENT_INVALID_COMBINATION');                            -- PER_UNIT without a rate
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X5_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 0, p_rate_multiplier => 1.4)$q$, 'COMPONENT_INVALID_COMBINATION');                     -- divisor 0
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X6_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'OVERTIME_HOURS', p_rate_mode => 'WAGE_FRACTION', p_unit_divisor => 220, p_rate_multiplier => 11)$q$, 'COMPONENT_INVALID_COMBINATION');                   -- multiplier 11
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X7_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'FOO', p_rate_mode => 'PER_UNIT', p_fixed_amount => 1, p_currency => 'IRR')$q$, 'COMPONENT_INVALID_COMBINATION');                      -- unknown quantity source
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X8_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1, p_currency => 'IRR', p_quantity_source => 'OVERTIME_HOURS')$q$, 'COMPONENT_INVALID_COMBINATION');                    -- quantity parameters on a FIXED component
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);                                                                                                   -- HR-only: no payroll tier
  perform pg_temp.expect_err($q$select public.create_salary_component(p_code => 'X9_P8T', p_component_type => 'EARNING', p_name_fa => 'x', p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01', p_quantity_source => 'MISSION_DAYS', p_rate_mode => 'PER_UNIT', p_fixed_amount => 1, p_currency => 'IRR')$q$, 'NOT_AUTHORIZED');
  execute 'reset role';
  perform pg_temp.expect_err(format($q$update public.salary_component_versions set unit_divisor = 200 where component_id = %L$q$, c_ot), 'PAYROLL_VERSION_FIELD_IMMUTABLE');   -- versions are frozen, new columns included

  -- compensation profiles
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform pg_temp.expect_err(format($q$select public.create_compensation_version(%L, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null,
      jsonb_build_array(jsonb_build_object('component_id', %L, 'amount_override', '1')))$q$, v_a, c_ot), 'COMPONENT_OVERRIDE_NOT_ALLOWED');                 -- WAGE_FRACTION has no per-person amount override
  perform public.create_compensation_version(v_a, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_ot), jsonb_build_object('component_id', c_abs), jsonb_build_object('component_id', c_miss), jsonb_build_object('component_id', c_ins)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', 150000, null, jsonb_build_array(                          -- explicit hourly rate on the profile
    jsonb_build_object('component_id', c_ot), jsonb_build_object('component_id', c_abs),
    jsonb_build_object('component_id', c_miss, 'amount_override', '700000'),                                                                              -- PER_UNIT: per-person rate override IS allowed
    jsonb_build_object('component_id', c_ins)));
  perform public.create_compensation_version(v_c, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_ot_rule), jsonb_build_object('component_id', c_abs_rule)));
  perform public.create_compensation_version(v_d, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_ot_badunit), jsonb_build_object('component_id', c_ot_norule), jsonb_build_object('component_id', c_ins)));
  perform public.create_compensation_version(v_e, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_ot), jsonb_build_object('component_id', c_abs)));
  perform public.create_compensation_version(v_f, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(jsonb_build_object('component_id', c_ot)));
  perform public.create_compensation_version(v_g, date '2070-01-01', 30000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(jsonb_build_object('component_id', c_ot), jsonb_build_object('component_id', c_bad)));
  perform public.create_compensation_version(v_i, date '2070-01-01', 30000000, 'IRR', 'MONTHLY');                                                          -- no quantity component at all

  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;
  perform public.save_payroll_work_data(v_period, v_a, p_overtime_hours => 10, p_absence_days => 2, p_mission_days => 3);
  perform public.save_payroll_work_data(v_period, v_b, p_overtime_hours => 10, p_absence_days => 0, p_mission_days => 2);
  perform public.save_payroll_work_data(v_period, v_c, p_overtime_hours => 10, p_absence_days => 2);
  perform public.save_payroll_work_data(v_period, v_d, p_overtime_hours => 10);
  perform public.save_payroll_work_data(v_period, v_e, p_absence_days => 1);                                  -- overtime NOT entered (NULL)
  -- v_f: no work-data row at all
  perform public.save_payroll_work_data(v_period, v_g, p_overtime_hours => 0, p_mission_days => 1);          -- explicit 0 overtime
  perform public.save_payroll_work_data(v_period, v_i, p_overtime_hours => 5);

  -- 3) calculate (payroll CREATE tier) --------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', 'TEST-P8')).id;
  v_c1 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  if (select engine_version from public.payroll_calculations where id = v_c1) <> 'PAYROLL_ENGINE_2' then raise exception 'FAIL(3): engine version'; end if;

  -- A: numbers on the component, base salary basis
  perform pg_temp.chk('A overtime', pg_temp.line_amt(v_c1, v_a, 'OT_P8T'), 1909091);
  perform pg_temp.chk('A absence',  pg_temp.line_amt(v_c1, v_a, 'ABS_P8T'), 2000000);
  perform pg_temp.chk('A mission',  pg_temp.line_amt(v_c1, v_a, 'MISS_P8T'), 1500000);
  perform pg_temp.chk('A ins (gross-based, includes overtime)', pg_temp.line_amt(v_c1, v_a, 'INS_P8T'), 2338636);
  perform pg_temp.chk('A gross', pg_temp.tot(v_c1, v_a, 'gross'), 33409091);
  perform pg_temp.chk('A ded',   pg_temp.tot(v_c1, v_a, 'ded'),   4338636);
  perform pg_temp.chk('A net',   pg_temp.tot(v_c1, v_a, 'net'),   29070455);
  if not pg_temp.complete(v_c1, v_a) then raise exception 'FAIL(3): A must be complete'; end if;
  if pg_temp.warn(v_c1, v_a, 'HOURS_NOT_APPLIED', 'INFO') then raise exception 'FAIL(3): A hours are consumed by components — no HOURS_NOT_APPLIED'; end if;
  v_l := pg_temp.line(v_c1, v_a, 'OT_P8T');
  if v_l.method <> 'QUANTITY_X_RATE' or v_l.quantity <> 10 or v_l.quantity_unit <> 'HOURS' or v_l.rate_source <> 'COMPONENT' or v_l.amount_source <> 'COMPONENT_DEFAULT' then
    raise exception 'FAIL(3): A overtime line metadata (%)', to_jsonb(v_l);
  end if;
  if v_l.unit_rate not between 190909.09 and 190909.10 then raise exception 'FAIL(3): A displayed unit rate (%)', v_l.unit_rate; end if;
  if v_l.details ->> 'wage_source' <> 'BASE_SALARY' or v_l.details ->> 'divisor_source' <> 'COMPONENT' or v_l.details ->> 'multiplier_source' <> 'COMPONENT' then
    raise exception 'FAIL(3): A details (%)', v_l.details;
  end if;
  v_l := pg_temp.line(v_c1, v_a, 'ABS_P8T');
  if v_l.quantity_unit <> 'DAYS' or v_l.quantity <> 2 then raise exception 'FAIL(3): A absence quantity / unit'; end if;

  -- B: the profile's explicit hourly rate wins for HOUR quantities; per-person PER_UNIT override; zero quantity = zero line
  perform pg_temp.chk('B overtime (hourly rate)', pg_temp.line_amt(v_c1, v_b, 'OT_P8T'), 2100000);
  perform pg_temp.chk('B absence qty 0 (days -> base salary basis)', pg_temp.line_amt(v_c1, v_b, 'ABS_P8T'), 0);
  perform pg_temp.chk('B mission override', pg_temp.line_amt(v_c1, v_b, 'MISS_P8T'), 1400000);
  perform pg_temp.chk('B gross', pg_temp.tot(v_c1, v_b, 'gross'), 33500000);
  perform pg_temp.chk('B net',   pg_temp.tot(v_c1, v_b, 'net'),   31155000);
  v_l := pg_temp.line(v_c1, v_b, 'OT_P8T');
  if v_l.rate_source <> 'PROFILE_HOURLY' or v_l.details ->> 'wage_source' <> 'PROFILE_HOURLY' or v_l.unit_rate <> 210000 then raise exception 'FAIL(3): B hourly-rate metadata (%)', to_jsonb(v_l); end if;
  if pg_temp.line(v_c1, v_b, 'MISS_P8T').rate_source <> 'COMPENSATION_OVERRIDE' then raise exception 'FAIL(3): B mission override source'; end if;
  if pg_temp.line_status(v_c1, v_b, 'ABS_P8T') <> 'COMPUTED' or pg_temp.warn(v_c1, v_b, 'QUANTITY_MISSING', 'CRITICAL') then raise exception 'FAIL(3): an explicit 0 is a valid zero line'; end if;

  -- C: both numbers from the APPROVED rule set
  perform pg_temp.chk('C overtime (rule)', pg_temp.line_amt(v_c1, v_c, 'OTR_P8T'), 1909091);
  perform pg_temp.chk('C absence (rule)',  pg_temp.line_amt(v_c1, v_c, 'ABSR_P8T'), 2000000);
  perform pg_temp.chk('C net', pg_temp.tot(v_c1, v_c, 'net'), 29909091);
  v_l := pg_temp.line(v_c1, v_c, 'OTR_P8T');
  if v_l.amount_source <> 'RULE' or v_l.rate_source <> 'RULE' or v_l.details -> 'divisor_rule' ->> 'rule_key' <> 'ot_hours_basis'
     or v_l.details -> 'multiplier_rule' ->> 'rule_key' <> 'ot_multiplier' or (v_l.details -> 'divisor_rule' ->> 'rule_set_id')::uuid <> v_set then
    raise exception 'FAIL(3): C rule traceability (%)', v_l.details;
  end if;

  -- D: wrong unit / missing rule -> CRITICAL for THOSE lines, no amount, result incomplete, gross-based line blocked
  if pg_temp.line_status(v_c1, v_d, 'OTU_P8T') <> 'NOT_COMPUTED' or pg_temp.line_amt(v_c1, v_d, 'OTU_P8T') is not null then raise exception 'FAIL(3): D wrong-unit line must not be computed'; end if;
  if pg_temp.line_status(v_c1, v_d, 'OTN_P8T') <> 'NOT_COMPUTED' then raise exception 'FAIL(3): D missing-rule line must not be computed'; end if;
  if not pg_temp.warn(v_c1, v_d, 'RULE_VALUE_INVALID', 'CRITICAL') or not pg_temp.warn(v_c1, v_d, 'RULE_MISSING', 'CRITICAL') then raise exception 'FAIL(3): D rule warnings'; end if;
  if not pg_temp.warn(v_c1, v_d, 'GROSS_BASIS_INCOMPLETE', 'CRITICAL') then raise exception 'FAIL(3): D gross-based line must be blocked by the incomplete earnings'; end if;
  if pg_temp.complete(v_c1, v_d) then raise exception 'FAIL(3): D must be incomplete'; end if;

  -- E / F: quantity not entered = CRITICAL (never assumed 0)
  if pg_temp.line_status(v_c1, v_e, 'OT_P8T') <> 'NOT_COMPUTED' or not pg_temp.warn(v_c1, v_e, 'QUANTITY_MISSING', 'CRITICAL') then raise exception 'FAIL(3): E overtime NULL = QUANTITY_MISSING'; end if;
  perform pg_temp.chk('E absence still computed', pg_temp.line_amt(v_c1, v_e, 'ABS_P8T'), 1000000);
  if pg_temp.complete(v_c1, v_e) then raise exception 'FAIL(3): E must be incomplete'; end if;
  if not pg_temp.warn(v_c1, v_f, 'QUANTITY_MISSING', 'CRITICAL') or not pg_temp.warn(v_c1, v_f, 'MISSING_WORK_DATA', 'WARNING') then raise exception 'FAIL(3): F no work data'; end if;

  -- G: explicit zero overtime + currency mismatch on a PER_UNIT component
  perform pg_temp.chk('G zero overtime', pg_temp.line_amt(v_c1, v_g, 'OT_P8T'), 0);
  if pg_temp.line_status(v_c1, v_g, 'USD_P8T') <> 'NOT_COMPUTED' or not pg_temp.warn(v_c1, v_g, 'CURRENCY_MISMATCH', 'CRITICAL') then raise exception 'FAIL(3): G currency mismatch'; end if;

  -- I: hours exist but no component of the profile consumes them
  if not pg_temp.warn(v_c1, v_i, 'HOURS_NOT_APPLIED', 'INFO') then raise exception 'FAIL(3): I unconsumed overtime must be flagged'; end if;
  if (select gross from public.payroll_results where calculation_id = v_c1 and personnel_id = v_i) <> 30000000 then raise exception 'FAIL(3): I unconsumed hours must not change money'; end if;

  -- 4) determinism: a second calculation of unchanged data gives identical numbers -------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_c2 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  if v_c2 = v_c1 then raise exception 'FAIL(4): a new calculation row is expected'; end if;
  perform pg_temp.chk('repeat A net', pg_temp.tot(v_c2, v_a, 'net'), pg_temp.tot(v_c1, v_a, 'net'));
  perform pg_temp.chk('repeat B net', pg_temp.tot(v_c2, v_b, 'net'), pg_temp.tot(v_c1, v_b, 'net'));
  perform pg_temp.chk('repeat C net', pg_temp.tot(v_c2, v_c, 'net'), pg_temp.tot(v_c1, v_c, 'net'));

  -- 5) the old calculation rows are untouched (immutable history) and the work-data staleness still works --------------------------------------------
  perform pg_temp.expect_err(format($q$update public.payroll_result_lines set amount = 1 where result_id in (select id from public.payroll_results where calculation_id = %L)$q$, v_c1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.save_payroll_work_data(v_period, v_a, p_overtime_hours => 11, p_absence_days => 2, p_mission_days => 3);
  execute 'reset role';                                                                                      -- (the stale check is an internal helper)
  if not ('WORK_DATA_CHANGED' = any (public._payroll_batch_stale(v_batch))) then raise exception 'FAIL(5): changed hours must mark the calculation stale'; end if;

  -- 6) audit: no amounts / parameter values in the payroll logs ----------------------------------------------------------------------------------------
  execute 'reset role';
  select count(*) into v_n from public.activity_logs
   where entity_type like 'payroll\_%' escape '\' and created_at = now()
     and (coalesce(old_value::text, '') || coalesce(new_value::text, '')) ~ '\y(1909091|2000000|1500000|2338636|33409091|29070455|2100000|1400000)\y';
  if v_n <> 0 then raise exception 'FAIL(6): % payroll activity_logs rows contain amounts', v_n; end if;

  execute 'set constraints all immediate';
  raise notice 'PASS: payroll overtime / absence (QUANTITY_X_RATE) integrity checks';
end $$;

rollback;

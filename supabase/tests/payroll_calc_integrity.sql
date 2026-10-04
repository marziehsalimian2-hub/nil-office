-- =============================================================================
-- NIL Office — HR & Payroll Phase 3 (calculation engine) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0123, with at least
-- one active ADMIN profile. ONE transaction, ROLLED BACK at the end. The script
-- temporarily re-roles the first ADMIN profile (rolled back) — do NOT run it while
-- that admin is actively using the app. All rule keys/values/amounts are SYNTHETIC
-- (jurisdiction 'TEST-P3', period 1450/01) and exist only inside the rollback.
-- Real personnel are also eligible for that far-future period; assertions only
-- look at the fixture personnel ids.
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_hr text, p_payroll text) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles set role = p_role::app_role, hr_role = p_hr::hr_role, payroll_role = p_payroll::payroll_role where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
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
create function pg_temp.tot(p_calc uuid, p_person uuid, p_col text) returns numeric language sql as $$
  select case p_col when 'gross' then r.gross when 'ded' then r.total_deductions when 'emp' then r.employer_cost when 'net' then r.net end
    from public.payroll_results r where r.calculation_id = p_calc and r.personnel_id = p_person $$;
create function pg_temp.warn(p_calc uuid, p_person uuid, p_code text, p_sev text) returns boolean language sql as $$
  select exists (select 1 from public.payroll_calc_warnings w where w.calculation_id = p_calc
                  and w.personnel_id is not distinct from p_person and w.code = p_code and w.severity = p_sev) $$;
create function pg_temp.has_result(p_calc uuid, p_person uuid) returns boolean language sql as $$
  select exists (select 1 from public.payroll_results r where r.calculation_id = p_calc and r.personnel_id = p_person) $$;

do $$
declare
  v_admin uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_i uuid; v_ids uuid[];
  c_house uuid; c_bonus uuid; c_trans uuid; c_ins uuid; c_loan uuid; c_er uuid; c_info uuid;
  c_qxr uuid; c_miss uuid; c_bad uuid; c_circ uuid;
  v_set uuid; v_period uuid; v_batch uuid; v_usd uuid; v_batch2 uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid; v_cu uuid;
  v_cnt int; v_txt text; v_j jsonb; v_bnum text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  -- 0) numbering regression (0118 restated the FULL list) -------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  execute 'reset role';
  if public.format_display_number('INVOICE',1405,1) <> 'INV-1405-0001'
     or public.format_display_number('PERSONNEL',1405,1) <> 'EMP-1405-0001'
     or public.format_display_number('PAYMENT',1405,7) <> 'PMT-1405-0007'
     or public.format_display_number('CASE',1405,1) <> 'CASE-1405-0001'
     or public.format_display_number('OUTGOING',1405,70) <> 'ص-1405-0070'
     or public.format_display_number('PAYROLL_BATCH',1450,7) <> 'PRL-1450-0007' then
    raise exception 'FAIL(0): format_display_number regression';
  end if;
  perform pg_temp.expect_err($q$insert into public.number_sequences (scope, year) values ('BOGUS_SCOPE', 1)$q$, 'ck_sequence_scope');

  -- 1) fixtures ---------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف','تست', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب','تست',   date '2071-04-10', 'کارشناس', 'FULL_TIME')).id;   -- hired mid-period
  v_c := (public.onboard_personnel('ج','تست',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- terminated at period start
  v_d := (public.onboard_personnel('د','تست',   date '2071-05-01', 'کارشناس', 'FULL_TIME')).id;   -- hired after period end
  v_e := (public.onboard_personnel('ه','تست',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- terminated mid-period
  v_f := (public.onboard_personnel('و','تست',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- USD
  v_g := (public.onboard_personnel('ز','تست',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- negative net
  v_i := (public.onboard_personnel('ی','تست',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- no profile
  v_ids := array[v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_i];
  perform public.change_personnel_status(v_c, 'TERMINATED', 'test', date '2071-03-21');
  perform public.change_personnel_status(v_e, 'TERMINATED', 'test', date '2071-04-05');

  c_house := (public.create_salary_component(p_code => 'HOUSING_P3T', p_component_type => 'EARNING', p_name_fa => 'مسکن',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000.5, p_currency => 'IRR')).component_id;
  c_bonus := (public.create_salary_component(p_code => 'BONUS_P3T', p_component_type => 'EARNING', p_name_fa => 'پاداش',
              p_calculation_method => 'MANUAL_INPUT', p_effective_from => date '2000-01-01')).component_id;
  c_trans := (public.create_salary_component(p_code => 'TRANS_P3T', p_component_type => 'EARNING', p_name_fa => 'ایاب',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage => 3.5, p_percentage_basis => 'BASE_SALARY')).component_id;
  c_ins := (public.create_salary_component(p_code => 'INS_P3T', p_component_type => 'DEDUCTION', p_name_fa => 'بیمه',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'GROSS_EARNINGS', p_rule_key => 'test_ins_rate')).component_id;
  c_loan := (public.create_salary_component(p_code => 'LOAN_P3T', p_component_type => 'DEDUCTION', p_name_fa => 'وام',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 2000000, p_currency => 'IRR')).component_id;
  c_er := (public.create_salary_component(p_code => 'ER_P3T', p_component_type => 'EMPLOYER_COST', p_name_fa => 'سهم کارفرما',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'BASE_SALARY', p_rule_key => 'test_ins_rate')).component_id;
  c_info := (public.create_salary_component(p_code => 'INFO_P3T', p_component_type => 'INFORMATIONAL', p_name_fa => 'اطلاعاتی',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 123456, p_currency => 'IRR')).component_id;
  c_qxr := (public.create_salary_component(p_code => 'QXR_P3T', p_component_type => 'EARNING', p_name_fa => 'مقدار در نرخ',
              p_calculation_method => 'QUANTITY_X_RATE', p_effective_from => date '2000-01-01')).component_id;
  c_miss := (public.create_salary_component(p_code => 'MISS_P3T', p_component_type => 'DEDUCTION', p_name_fa => 'قاعده ناموجود',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'BASE_SALARY', p_rule_key => 'test_missing_key')).component_id;
  c_bad := (public.create_salary_component(p_code => 'BAD_P3T', p_component_type => 'DEDUCTION', p_name_fa => 'واحد نامعتبر',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'BASE_SALARY', p_rule_key => 'test_bad_unit')).component_id;
  c_circ := (public.create_salary_component(p_code => 'CIRC_P3T', p_component_type => 'EARNING', p_name_fa => 'دوری',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage => 10, p_percentage_basis => 'GROSS_EARNINGS')).component_id;

  v_set := (public.create_legal_rule_set('قواعد فاز۳', 'TEST-P3', date '2000-01-01')).id;
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'test_ins_rate', p_value_numeric => 7, p_unit => 'PERCENT');
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set, p_rule_key => 'test_bad_unit', p_value_numeric => 0.07, p_unit => 'RATE');
  perform public.change_legal_rule_set_status(v_set, 'REVIEWED');
  perform public.change_legal_rule_set_status(v_set, 'APPROVED');

  perform public.create_compensation_version(v_a, date '2070-01-01', 10000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_house), jsonb_build_object('component_id', c_bonus), jsonb_build_object('component_id', c_trans),
    jsonb_build_object('component_id', c_ins), jsonb_build_object('component_id', c_loan), jsonb_build_object('component_id', c_er),
    jsonb_build_object('component_id', c_info)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 5000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_qxr), jsonb_build_object('component_id', c_bonus), jsonb_build_object('component_id', c_miss),
    jsonb_build_object('component_id', c_bad), jsonb_build_object('component_id', c_ins)));
  perform public.create_compensation_version(v_e, date '2070-01-01', 3000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_circ)));
  perform public.create_compensation_version(v_g, date '2070-01-01', 1000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_loan)));
  perform public.create_compensation_version(v_f, date '2070-01-01', 1000, 'USD', 'MONTHLY');
  perform public.add_payment_destination(v_a, 'بانک تست', 'الف تست', null, 'IR' || '062960000000100324200001');

  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;
  perform public.save_payroll_work_data(v_period, v_a, p_work_days => 30, p_overtime_hours => 5,
    p_inputs => jsonb_build_array(jsonb_build_object('component_id', c_bonus, 'amount', '500000', 'currency', 'IRR')));

  -- period validation
  perform pg_temp.expect_err(format('select public.create_payroll_period(1450,1,%L,%L)', date '2071-03-21', date '2071-04-20'), 'PAYROLL_PERIOD_DUPLICATE');
  perform pg_temp.expect_err(format('select public.create_payroll_period(1450,2,%L,%L)', date '2071-04-21', date '2071-05-20'), 'PAYROLL_PERIOD_INVALID');   -- month 2 must be 31 days
  perform pg_temp.expect_err(format('select public.create_payroll_period(1450,3,%L,%L)', date '2071-05-01', date '2071-05-31'), 'PAYROLL_PERIOD_INVALID');   -- start not near expected
  perform public.create_payroll_period(1450, 2, date '2071-04-21', date '2071-05-21');

  -- 2) batch + calculation #1 (HALF_UP, scale 0), as payroll CREATE tier -------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', 'TEST-P3')).id;
  select batch_number into v_bnum from public.payroll_batches where id = v_batch;
  if v_bnum !~ '^PRL-1450-[0-9]{4}$' then raise exception 'FAIL(2): batch number %', v_bnum; end if;
  perform pg_temp.expect_err(format('select public.create_payroll_batch(%L,%L,0,%L)', v_period, 'IRR', 'HALF_UP'), 'PAYROLL_BATCH_DUPLICATE');
  perform pg_temp.expect_err(format('select public.create_payroll_batch(%L,%L,9,%L)', v_period, 'USD', 'HALF_UP'), 'PAYROLL_ROUNDING_INVALID');
  perform pg_temp.expect_err(format('select public.create_payroll_batch(%L,%L,0,%L,%L)', v_period, 'USD', 'HALF_UP', 'NO-SUCH-LAND'), 'PAYROLL_JURISDICTION_UNKNOWN');
  v_c1 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';

  -- A: hand-computed. gross = 10,000,000 + 1,000,001 (1,000,000.5 half-up) + 500,000 + 350,000 = 11,850,001
  perform pg_temp.chk('A base',    pg_temp.line_amt(v_c1, v_a, 'BASE_SALARY'), 10000000);
  perform pg_temp.chk('A housing', pg_temp.line_amt(v_c1, v_a, 'HOUSING_P3T'), 1000001);
  perform pg_temp.chk('A bonus',   pg_temp.line_amt(v_c1, v_a, 'BONUS_P3T'),   500000);
  perform pg_temp.chk('A trans',   pg_temp.line_amt(v_c1, v_a, 'TRANS_P3T'),   350000);        -- 10,000,000 * 3.5%
  perform pg_temp.chk('A ins',     pg_temp.line_amt(v_c1, v_a, 'INS_P3T'),     829500);        -- 7% of 11,850,001 = 829,500.07 -> 829,500
  perform pg_temp.chk('A loan',    pg_temp.line_amt(v_c1, v_a, 'LOAN_P3T'),    2000000);
  perform pg_temp.chk('A er',      pg_temp.line_amt(v_c1, v_a, 'ER_P3T'),      700000);        -- 7% of BASE
  perform pg_temp.chk('A info',    pg_temp.line_amt(v_c1, v_a, 'INFO_P3T'),    123456);
  perform pg_temp.chk('A gross',   pg_temp.tot(v_c1, v_a, 'gross'), 11850001);
  perform pg_temp.chk('A ded',     pg_temp.tot(v_c1, v_a, 'ded'),   2829500);
  perform pg_temp.chk('A emp',     pg_temp.tot(v_c1, v_a, 'emp'),   700000);                    -- employer cost never reduces net
  perform pg_temp.chk('A net',     pg_temp.tot(v_c1, v_a, 'net'),   9020501);                   -- INFORMATIONAL excluded from totals
  if not (select is_complete from public.payroll_results where calculation_id = v_c1 and personnel_id = v_a) then raise exception 'FAIL(2): A not complete'; end if;
  if pg_temp.warn(v_c1, v_a, 'MISSING_BANK_DESTINATION', 'WARNING') then raise exception 'FAIL(2): A has a destination'; end if;
  if pg_temp.warn(v_c1, v_a, 'MISSING_WORK_DATA', 'WARNING') then raise exception 'FAIL(2): A has work data'; end if;
  if not pg_temp.warn(v_c1, v_a, 'HOURS_NOT_APPLIED', 'INFO') then raise exception 'FAIL(2): A overtime must be INFO-only'; end if;
  if (select critical_count from public.payroll_results where calculation_id = v_c1 and personnel_id = v_a) <> 0 then raise exception 'FAIL(2): A has CRITICAL'; end if;

  -- B: unsupported method / missing rule / bad unit / missing manual input / gross basis incomplete -> CRITICAL, NO amount
  if pg_temp.line_status(v_c1, v_b, 'QXR_P3T') <> 'NOT_COMPUTED' or pg_temp.line_amt(v_c1, v_b, 'QXR_P3T') is not null then raise exception 'FAIL(2): QXR must not be computed'; end if;
  if not pg_temp.warn(v_c1, v_b, 'UNSUPPORTED_METHOD', 'CRITICAL') then raise exception 'FAIL(2): UNSUPPORTED_METHOD'; end if;
  if not pg_temp.warn(v_c1, v_b, 'RULE_MISSING', 'CRITICAL') then raise exception 'FAIL(2): RULE_MISSING'; end if;
  if pg_temp.line_amt(v_c1, v_b, 'MISS_P3T') is not null then raise exception 'FAIL(2): missing rule produced an amount'; end if;
  if not pg_temp.warn(v_c1, v_b, 'RULE_VALUE_INVALID', 'CRITICAL') then raise exception 'FAIL(2): RULE_VALUE_INVALID (unit RATE)'; end if;
  if not pg_temp.warn(v_c1, v_b, 'MANUAL_INPUT_MISSING', 'CRITICAL') then raise exception 'FAIL(2): MANUAL_INPUT_MISSING'; end if;
  if not pg_temp.warn(v_c1, v_b, 'GROSS_BASIS_INCOMPLETE', 'CRITICAL') then raise exception 'FAIL(2): GROSS_BASIS_INCOMPLETE'; end if;
  if pg_temp.line_amt(v_c1, v_b, 'INS_P3T') is not null then raise exception 'FAIL(2): gross-basis line computed on incomplete gross'; end if;
  perform pg_temp.chk('B gross', pg_temp.tot(v_c1, v_b, 'gross'), 5000000);
  if (select is_complete from public.payroll_results where calculation_id = v_c1 and personnel_id = v_b) then raise exception 'FAIL(2): B must be incomplete'; end if;
  if not pg_temp.warn(v_c1, v_b, 'PARTIAL_PERIOD', 'WARNING') or not pg_temp.warn(v_c1, v_b, 'MISSING_WORK_DATA', 'WARNING')
     or not pg_temp.warn(v_c1, v_b, 'MISSING_BANK_DESTINATION', 'WARNING') then raise exception 'FAIL(2): B warnings'; end if;

  -- E: terminated mid-period (eligible, partial) + circular earning
  if not pg_temp.warn(v_c1, v_e, 'CIRCULAR_BASIS', 'CRITICAL') or pg_temp.line_amt(v_c1, v_e, 'CIRC_P3T') is not null then raise exception 'FAIL(2): CIRCULAR_BASIS'; end if;
  if not pg_temp.warn(v_c1, v_e, 'PARTIAL_PERIOD', 'WARNING') then raise exception 'FAIL(2): E partial'; end if;
  perform pg_temp.chk('E gross', pg_temp.tot(v_c1, v_e, 'gross'), 3000000);
  -- G: negative net = CRITICAL
  perform pg_temp.chk('G net', pg_temp.tot(v_c1, v_g, 'net'), -1000000);
  if not pg_temp.warn(v_c1, v_g, 'NEGATIVE_NET', 'CRITICAL') then raise exception 'FAIL(2): NEGATIVE_NET'; end if;
  -- I: no profile
  if not pg_temp.warn(v_c1, v_i, 'MISSING_COMPENSATION', 'CRITICAL') or not pg_temp.has_result(v_c1, v_i) then raise exception 'FAIL(2): MISSING_COMPENSATION'; end if;
  -- eligibility by dates: C (ended at period_start, half-open), D (hired after period_end), F (USD) are NOT in the IRR batch
  if pg_temp.has_result(v_c1, v_c) or pg_temp.has_result(v_c1, v_d) or pg_temp.has_result(v_c1, v_f) then
    raise exception 'FAIL(2): ineligible / other-currency personnel were calculated';
  end if;
  foreach v_c in array array[v_a, v_b, v_e, v_g, v_i] loop
    if not pg_temp.has_result(v_c1, v_c) then raise exception 'FAIL(2): eligible personnel missing %', v_c; end if;
  end loop;
  v_c := (select id from public.personnel where first_name = 'ج' and last_name = 'تست' order by created_at desc limit 1);   -- restore v_c

  -- 3) deterministic recalculation: calc #2 with identical inputs ==> identical lines/totals; history kept ------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_c2 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  select count(*) into v_cnt from (
    (select r.personnel_id, l.component_code, l.status, l.amount, l.base_amount, l.rate, l.rule_entry_id
       from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id where r.calculation_id = v_c1 and r.personnel_id = any(v_ids)
     except
     select r.personnel_id, l.component_code, l.status, l.amount, l.base_amount, l.rate, l.rule_entry_id
       from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id where r.calculation_id = v_c2 and r.personnel_id = any(v_ids))
    union all
    (select r.personnel_id, l.component_code, l.status, l.amount, l.base_amount, l.rate, l.rule_entry_id
       from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id where r.calculation_id = v_c2 and r.personnel_id = any(v_ids)
     except
     select r.personnel_id, l.component_code, l.status, l.amount, l.base_amount, l.rate, l.rule_entry_id
       from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id where r.calculation_id = v_c1 and r.personnel_id = any(v_ids))) d;
  if v_cnt <> 0 then raise exception 'FAIL(3): recalculation is not deterministic (% differing lines)', v_cnt; end if;
  select count(*) into v_cnt from (
    (select personnel_id, gross, total_deductions, employer_cost, net, is_complete from public.payroll_results where calculation_id = v_c1 and personnel_id = any(v_ids)
     except select personnel_id, gross, total_deductions, employer_cost, net, is_complete from public.payroll_results where calculation_id = v_c2 and personnel_id = any(v_ids))
    union all
    (select personnel_id, gross, total_deductions, employer_cost, net, is_complete from public.payroll_results where calculation_id = v_c2 and personnel_id = any(v_ids)
     except select personnel_id, gross, total_deductions, employer_cost, net, is_complete from public.payroll_results where calculation_id = v_c1 and personnel_id = any(v_ids))) d;
  if v_cnt <> 0 then raise exception 'FAIL(3): totals differ between identical calculations'; end if;
  select count(*) into v_cnt from public.payroll_calculations where batch_id = v_batch;
  if v_cnt <> 2 then raise exception 'FAIL(3): expected 2 calculations kept as history, got %', v_cnt; end if;
  if (select current_calculation_id from public.payroll_batches where id = v_batch) <> v_c2
     or (select calculation_version from public.payroll_batches where id = v_batch) <> 2 then raise exception 'FAIL(3): current pointer'; end if;
  if not exists (select 1 from public.payroll_results where calculation_id = v_c1) then raise exception 'FAIL(3): superseded results were lost'; end if;
  -- immutability / no-delete of calculation artefacts
  perform pg_temp.expect_err(format('update public.payroll_result_lines set amount = 1 where id = (select l.id from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id where r.calculation_id = %L limit 1)', v_c1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.payroll_results set net = 1 where calculation_id = %L', v_c1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.payroll_calculations set rounding_scale = 1 where id = %L', v_c1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('delete from public.payroll_results where calculation_id = %L', v_c1), 'PAYROLL_NO_DELETE');
  perform pg_temp.expect_err(format('delete from public.payroll_batches where id = %L', v_batch), 'PAYROLL_NO_DELETE');
  perform pg_temp.expect_err(format('update public.payroll_batches set currency = %L where id = %L', 'USD', v_batch), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.payroll_batches set status = %L where id = %L', 'DRAFT', v_batch), 'INVALID_STATUS_TRANSITION');

  -- 4) USD batch: F calculated there only, A absent; read RPC returns exact text amounts -------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_usd := (public.create_payroll_batch(v_period, 'USD', 2, 'HALF_UP', null)).id;
  v_cu := (public.calculate_payroll_batch(v_usd)).id;
  execute 'reset role';
  perform pg_temp.chk('F gross (USD scale 2)', pg_temp.tot(v_cu, v_f, 'gross'), 1000);
  if pg_temp.has_result(v_cu, v_a) then raise exception 'FAIL(4): IRR person appeared in the USD batch'; end if;
  if not pg_temp.warn(v_cu, v_i, 'MISSING_COMPENSATION', 'CRITICAL') then raise exception 'FAIL(4): no-profile person must appear in every batch'; end if;
  select count(*) into v_cnt from public.payroll_results r join public.payroll_batches b on b.current_calculation_id = r.calculation_id
   where b.period_id = v_period and r.currency is not null and r.personnel_id = any(v_ids) group by r.personnel_id having count(*) > 1;
  if coalesce(v_cnt, 0) <> 0 then raise exception 'FAIL(4): a person has two final payrolls in one period'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_review_data(v_batch);
  select r ->> 'net' into v_txt from jsonb_array_elements(v_j -> 'results') r where r ->> 'personnel_id' = v_a::text;
  if v_txt <> '9020501.0000' then raise exception 'FAIL(4): review RPC net text %', v_txt; end if;
  perform pg_temp.expect_err(format('select public.calculate_payroll_batch(%L)', v_batch), 'NOT_AUTHORIZED');   -- VIEW cannot calculate

  -- 5) rounding policy: DOWN, then UP (hand-computed) -------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.update_payroll_batch_settings(v_batch, 'TEST-P3', 0, 'DOWN');
  if not (public.payroll_review_data(v_batch) -> 'stale') ? 'SETTINGS_CHANGED' then raise exception 'FAIL(5): settings change must make the batch stale'; end if;
  v_c3 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  perform pg_temp.chk('DOWN housing', pg_temp.line_amt(v_c3, v_a, 'HOUSING_P3T'), 1000000);
  perform pg_temp.chk('DOWN gross',   pg_temp.tot(v_c3, v_a, 'gross'), 11850000);
  perform pg_temp.chk('DOWN ins',     pg_temp.line_amt(v_c3, v_a, 'INS_P3T'), 829500);
  perform pg_temp.chk('DOWN net',     pg_temp.tot(v_c3, v_a, 'net'), 9020500);
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.update_payroll_batch_settings(v_batch, 'TEST-P3', 0, 'UP');
  v_c4 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  perform pg_temp.chk('UP housing', pg_temp.line_amt(v_c4, v_a, 'HOUSING_P3T'), 1000001);
  perform pg_temp.chk('UP ins',     pg_temp.line_amt(v_c4, v_a, 'INS_P3T'), 829501);               -- 829,500.07 rounded up
  perform pg_temp.chk('UP net',     pg_temp.tot(v_c4, v_a, 'net'), 9020500);                       -- 11,850,001 - (829,501 + 2,000,000)
  if (select rounding_mode from public.payroll_calculations where id = v_c3) <> 'DOWN' then raise exception 'FAIL(5): rounding not snapshotted'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.update_payroll_batch_settings(v_batch, 'TEST-P3', 0, 'HALF_UP');

  -- 6) eligibility overrides: APPROVE + reason; CREATE cannot -----------------------------------------------------
  perform pg_temp.expect_err(format('select public.set_payroll_eligibility_override(%L,%L,%L,%L)', v_batch, v_g, 'EXCLUDE', 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.set_payroll_eligibility_override(%L,%L,%L)', v_batch, v_g, 'EXCLUDE'), 'REASON_REQUIRED');
  perform pg_temp.expect_err(format('select public.set_payroll_eligibility_override(%L,%L,%L,%L)', v_batch, v_f, 'INCLUDE', 'x'), 'PAYROLL_OVERRIDE_INVALID');   -- USD profile cannot be forced into IRR
  perform public.set_payroll_eligibility_override(v_batch, v_g, 'EXCLUDE', 'test exclude');
  perform public.set_payroll_eligibility_override(v_batch, v_d, 'INCLUDE', 'test include');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_c5 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  if pg_temp.has_result(v_c5, v_g) then raise exception 'FAIL(6): EXCLUDE ignored'; end if;
  if not pg_temp.has_result(v_c5, v_d) or not pg_temp.warn(v_c5, v_d, 'ELIGIBILITY_OVERRIDDEN', 'WARNING') then raise exception 'FAIL(6): INCLUDE override'; end if;
  perform pg_temp.chk('A net back to HALF_UP', pg_temp.tot(v_c5, v_a, 'net'), 9020501);

  -- 7) staleness + status flow ---------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.save_payroll_work_data(v_period, v_a, p_work_days => 29, p_overtime_hours => 5,
    p_inputs => jsonb_build_array(jsonb_build_object('component_id', c_bonus, 'amount', '500000', 'currency', 'IRR')));
  if not (public.payroll_review_data(v_batch) -> 'stale') ? 'WORK_DATA_CHANGED' then raise exception 'FAIL(7): work-data edit must mark stale'; end if;
  perform pg_temp.chk('results not silently changed', (select net from public.payroll_results where calculation_id = v_c5 and personnel_id = v_a), 9020501);
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L)', v_batch, 'UNDER_REVIEW'), 'PAYROLL_BATCH_STALE');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L)', v_batch, 'CALCULATED'), 'INVALID_STATUS_TRANSITION');
  v_c6 := (public.calculate_payroll_batch(v_batch)).id;
  if jsonb_array_length(public.payroll_review_data(v_batch) -> 'stale') <> 0 then raise exception 'FAIL(7): stale after recalculation'; end if;
  perform public.change_payroll_batch_status(v_batch, 'UNDER_REVIEW');
  perform pg_temp.expect_err(format('select public.mark_payroll_batch_reviewed(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.calculate_payroll_batch(%L)', v_batch), 'INVALID_STATUS_TRANSITION');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.mark_payroll_batch_reviewed(v_batch);
  perform pg_temp.expect_err(format('select public.mark_payroll_batch_reviewed(%L)', v_batch), 'PAYROLL_ALREADY_REVIEWED');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L)', v_batch, 'CALCULATED'), 'REASON_REQUIRED');
  perform public.change_payroll_batch_status(v_batch, 'CALCULATED', 'send back test');
  execute 'reset role';
  if (select reviewed_at from public.payroll_batches where id = v_batch) is not null then raise exception 'FAIL(7): reviewed stamp not cleared on send-back'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L,%L)', v_batch, 'CANCELLED', 'x'), 'NOT_AUTHORIZED');   -- CALCULATED -> CANCELLED needs APPROVE
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L)', v_batch, 'CANCELLED'), 'REASON_REQUIRED');
  perform public.change_payroll_batch_status(v_batch, 'CANCELLED', 'cancel test');
  perform pg_temp.expect_err(format('select public.calculate_payroll_batch(%L)', v_batch), 'INVALID_STATUS_TRANSITION');
  execute 'reset role';
  perform pg_temp.expect_err(format('update public.payroll_batches set notes = %L where id = %L', 'x', v_batch), 'PAYROLL_BATCH_CANCELLED');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch2 := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', null)).id;      -- allowed again after cancel
  perform public.change_payroll_batch_status(v_batch2, 'CANCELLED', 'draft cancel');      -- DRAFT -> CANCELLED is CREATE tier

  -- 8) HR-only persona reads nothing, calls nothing ---------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  select count(*) into v_cnt from (
    select 1 from public.payroll_periods union all select 1 from public.payroll_batches union all select 1 from public.payroll_batch_transitions
    union all select 1 from public.payroll_eligibility_overrides union all select 1 from public.payroll_work_data
    union all select 1 from public.payroll_work_inputs union all select 1 from public.payroll_calculations
    union all select 1 from public.payroll_results union all select 1 from public.payroll_result_lines
    union all select 1 from public.payroll_calc_warnings) t;
  if v_cnt <> 0 then raise exception 'FAIL(8): HR-only persona read % payroll rows', v_cnt; end if;
  select count(*) into v_cnt from public.activity_logs where entity_type like 'payroll\_%' escape '\';
  if v_cnt <> 0 then raise exception 'FAIL(8): HR-only persona read % payroll log rows', v_cnt; end if;
  perform pg_temp.expect_err(format('select public.payroll_review_data(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.payroll_work_grid(%L)', v_period), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.calculate_payroll_batch(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.create_payroll_period(1450,5,%L,%L)', date '2071-07-23', date '2071-08-22'), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform pg_temp.expect_err(format('insert into public.payroll_results (calculation_id, batch_id, personnel_id, personnel_number, personnel_name, is_complete) values (%L,%L,%L,%L,%L,true)', v_c1, v_batch, v_a, 'x', 'x'), 'permission denied');

  -- 9) no amounts anywhere in activity_logs (checked as superuser) -----------------------------------------------------
  execute 'reset role';
  select count(*) into v_cnt from public.activity_logs
   where entity_type like 'payroll\_%' escape '\'
     and (coalesce(old_value::text, '') || coalesce(new_value::text, '')) ~ '\y(829500|829501|11850001|11850000|9020501|9020500|10000000|1000001|500000|2000000|123456|5000000|3000000)\y';
  if v_cnt <> 0 then raise exception 'FAIL(9): % activity_logs rows contain amounts', v_cnt; end if;
  select count(*) into v_cnt from public.activity_logs where entity_type = 'payroll_batches' and action = 'CALCULATED';
  if v_cnt < 6 then raise exception 'FAIL(9): expected CALCULATED log rows, got %', v_cnt; end if;
  select count(*) into v_cnt from public.activity_logs where entity_type in ('personnel','employment_records') and action like 'PAYROLL%';
  if v_cnt <> 0 then raise exception 'FAIL(9): payroll log written under an HR-readable entity type'; end if;

  -- 10) deferred FK (lines inserted before their result) really holds at commit -----------------------------------
  execute 'set constraints all immediate';

  raise notice 'PASS: payroll calculation phase integrity checks';
end $$;

rollback;

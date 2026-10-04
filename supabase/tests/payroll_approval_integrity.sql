-- =============================================================================
-- NIL Office — HR & Payroll Phase 4 (approval, lock, accounting draft) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0127, with at least one active ADMIN
-- profile. ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile
-- (rolled back) — do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC
-- (jurisdiction 'TEST-P4', period 1450/01, fiscal year 2071, accounts 'T4-*') and exists only inside the rollback.
-- Real personnel are EXCLUDED from the fixture batch through eligibility overrides (so they cannot add CRITICAL warnings).
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
-- Hand-computed expectations (HALF_UP, scale 0):
--   A: base 10,000,000 + house 1,000,000 = gross 11,000,000; insurance 7% of gross = 770,000; employer 7% of base = 700,000; net 10,230,000
--   B: base 5,000,000 + house 1,000,000 = gross 6,000,000; net 6,000,000
--   Journal (aggregated per component): Dr base 15,000,000; Dr house 2,000,000; Dr employer 700,000
--                                       Cr employer-payable 700,000; Cr insurance 770,000; Cr net payable 16,230,000
--   => 6 lines, debit = credit = 17,700,000
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_hr text, p_payroll text, p_acc text default null) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles
     set role = p_role::app_role, hr_role = p_hr::hr_role, payroll_role = p_payroll::payroll_role, accounting_role = p_acc::accounting_role
   where id = p_user;
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

create function pg_temp.tot(p_calc uuid, p_person uuid, p_col text) returns numeric language sql as $$
  select case p_col when 'gross' then r.gross when 'ded' then r.total_deductions when 'emp' then r.employer_cost when 'net' then r.net end
    from public.payroll_results r where r.calculation_id = p_calc and r.personnel_id = p_person $$;

create function pg_temp.crit(p_calc uuid) returns bigint language sql as $$
  select count(*) from public.payroll_calc_warnings w where w.calculation_id = p_calc and w.severity = 'CRITICAL' $$;

-- journal helpers (amount on one account code, either side)
create function pg_temp.jdebit(p_entry uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit), 0) from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
   where l.journal_entry_id = p_entry and a.code = p_code $$;
create function pg_temp.jcredit(p_entry uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(l.credit), 0) from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
   where l.journal_entry_id = p_entry and a.code = p_code $$;

-- CALCULATED/DRAFT batch -> calculate -> submit -> mark reviewed -> approve (three personas)
create function pg_temp.to_approved(p_user uuid, p_batch uuid) returns uuid language plpgsql as $$
declare v_calc uuid;
begin
  perform pg_temp.persona(p_user, 'USER', null, 'CREATE');
  v_calc := (public.calculate_payroll_batch(p_batch)).id;
  perform public.change_payroll_batch_status(p_batch, 'UNDER_REVIEW');
  perform pg_temp.persona(p_user, 'USER', null, 'APPROVE');
  perform public.mark_payroll_batch_reviewed(p_batch);
  perform public.approve_payroll_batch(p_batch);
  return v_calc;
end $$;

do $$
declare
  v_admin uuid; v_base text;
  v_a uuid; v_b uuid; v_c uuid; v_ids uuid[]; v_others uuid[]; v_o uuid;
  c_house uuid; c_ins uuid; c_er uuid; c_info uuid; c_miss uuid;
  v_set1 uuid; v_set2 uuid; v_period uuid; v_batch uuid; v_fy uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid;
  a_base uuid; a_house uuid; a_er_exp uuid; a_er_liab uuid; a_ins uuid; a_net uuid; a_inactive uuid; a_parent uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_n int; v_j jsonb; v_txt text; v_bnum text; v_lock boolean;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  select base_currency_code into v_base from public.app_settings where id = 1;
  update public.app_settings set base_currency_code = 'IRR' where id = 1;   -- the fixture batch is IRR (rolled back with everything)

  -- 1) fixtures (as ADMIN) --------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست۴', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست۴', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_c := (public.onboard_personnel('ج', 'تست۴', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;   -- carries a CRITICAL (missing rule) until excluded
  v_ids := array[v_a, v_b, v_c];

  c_house := (public.create_salary_component(p_code => 'HOUSE_P4T', p_component_type => 'EARNING', p_name_fa => 'مسکن',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000, p_currency => 'IRR')).component_id;
  c_ins := (public.create_salary_component(p_code => 'INS_P4T', p_component_type => 'DEDUCTION', p_name_fa => 'بیمه',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'GROSS_EARNINGS', p_rule_key => 'p4_rate')).component_id;
  c_er := (public.create_salary_component(p_code => 'ER_P4T', p_component_type => 'EMPLOYER_COST', p_name_fa => 'سهم کارفرما',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'BASE_SALARY', p_rule_key => 'p4_rate')).component_id;
  c_info := (public.create_salary_component(p_code => 'INFO_P4T', p_component_type => 'INFORMATIONAL', p_name_fa => 'اطلاعاتی',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 5000, p_currency => 'IRR')).component_id;
  c_miss := (public.create_salary_component(p_code => 'MISS_P4T', p_component_type => 'DEDUCTION', p_name_fa => 'قاعده ناموجود',
              p_calculation_method => 'PERCENTAGE', p_effective_from => date '2000-01-01', p_percentage_basis => 'BASE_SALARY', p_rule_key => 'p4_missing_key')).component_id;

  v_set1 := (public.create_legal_rule_set('قواعد فاز۴', 'TEST-P4', date '2000-01-01')).id;
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set1, p_rule_key => 'p4_rate', p_value_numeric => 7, p_unit => 'PERCENT');
  perform public.change_legal_rule_set_status(v_set1, 'REVIEWED');
  perform public.change_legal_rule_set_status(v_set1, 'APPROVED');

  perform public.create_compensation_version(v_a, date '2070-01-01', 10000000, 'IRR', 'MONTHLY', null, null, jsonb_build_array(
    jsonb_build_object('component_id', c_house), jsonb_build_object('component_id', c_ins),
    jsonb_build_object('component_id', c_er), jsonb_build_object('component_id', c_info)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 5000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  perform public.create_compensation_version(v_c, date '2070-01-01', 1000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_miss)));

  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;

  -- synthetic accounts + an OPEN fiscal year covering the period (superuser; rolled back with everything)
  execute 'reset role';
  insert into public.accounts (code, name, level, nature, account_type, is_active, allows_posting) values
    ('T4-EXP-BASE', 'test base salary expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T4-EXP-HOUSE', 'test housing expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T4-EXP-ER', 'test employer cost expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T4-LIAB-ER', 'test employer cost payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T4-LIAB-INS', 'test insurance payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T4-LIAB-NET', 'test payroll payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T4-INACTIVE', 'test inactive', 1, 'DEBIT', 'EXPENSE', false, true),
    ('T4-PARENT', 'test non-postable', 1, 'DEBIT', 'EXPENSE', true, false);
  select id into a_base from public.accounts where code = 'T4-EXP-BASE';
  select id into a_house from public.accounts where code = 'T4-EXP-HOUSE';
  select id into a_er_exp from public.accounts where code = 'T4-EXP-ER';
  select id into a_er_liab from public.accounts where code = 'T4-LIAB-ER';
  select id into a_ins from public.accounts where code = 'T4-LIAB-INS';
  select id into a_net from public.accounts where code = 'T4-LIAB-NET';
  select id into a_inactive from public.accounts where code = 'T4-INACTIVE';
  select id into a_parent from public.accounts where code = 'T4-PARENT';
  insert into public.fiscal_years (title, start_date, end_date, status) values ('TEST-P4', date '2071-03-01', date '2072-02-28', 'OPEN')
    returning id into v_fy;
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);

  -- 2) batch + calculation #1 (C has a missing rule => CRITICAL) ---------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', 'TEST-P4')).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_batch, v_o, 'EXCLUDE', 'phase4 test fixture isolation');
  end loop;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_c1 := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  perform pg_temp.chk('A net', pg_temp.tot(v_c1, v_a, 'net'), 10230000);
  perform pg_temp.chk('A ded', pg_temp.tot(v_c1, v_a, 'ded'), 770000);
  perform pg_temp.chk('A emp', pg_temp.tot(v_c1, v_a, 'emp'), 700000);
  perform pg_temp.chk('B net', pg_temp.tot(v_c1, v_b, 'net'), 6000000);
  if pg_temp.crit(v_c1) = 0 then raise exception 'FAIL(2): fixture C must raise a CRITICAL warning'; end if;

  -- 3) approval is refused: wrong status, dedicated RPC, not reviewed, CRITICAL ------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'INVALID_STATUS_TRANSITION');           -- still CALCULATED
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L)', v_batch, 'APPROVED'), 'PAYROLL_USE_APPROVE');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.change_payroll_batch_status(v_batch, 'UNDER_REVIEW');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'PAYROLL_NOT_REVIEWED');
  perform public.mark_payroll_batch_reviewed(v_batch);
  if not (public.payroll_review_data(v_batch) -> 'approval_blockers') ? 'CRITICAL' then raise exception 'FAIL(3): CRITICAL must be an approval blocker'; end if;
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'PAYROLL_HAS_CRITICAL');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'NOT_AUTHORIZED');                      -- CREATE tier cannot approve

  -- 4) fix the CRITICAL (exclude C), recalc, then a rule swap makes the batch stale (RULES_CHANGED) ----------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.change_payroll_batch_status(v_batch, 'CALCULATED', 'send back: exclude C');
  perform public.set_payroll_eligibility_override(v_batch, v_c, 'EXCLUDE', 'phase4 test: C has no rule');
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_c2 := (public.calculate_payroll_batch(v_batch)).id;
  perform public.change_payroll_batch_status(v_batch, 'UNDER_REVIEW');
  execute 'reset role';
  if pg_temp.crit(v_c2) <> 0 then raise exception 'FAIL(4): CRITICAL remains after excluding C (%)', pg_temp.crit(v_c2); end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'PAYROLL_NOT_REVIEWED');                 -- stamp cleared by the send-back
  perform public.mark_payroll_batch_reviewed(v_batch);

  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.change_legal_rule_set_status(v_set1, 'RETIRED', 'swap for phase4 test');
  v_set2 := (public.create_legal_rule_set('قواعد فاز۴ — ۲', 'TEST-P4', date '2000-01-01')).id;
  perform public.upsert_legal_rule_entry(p_rule_set_id => v_set2, p_rule_key => 'p4_rate', p_value_numeric => 7, p_unit => 'PERCENT');
  perform public.change_legal_rule_set_status(v_set2, 'REVIEWED');
  perform public.change_legal_rule_set_status(v_set2, 'APPROVED');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  if not (public.payroll_review_data(v_batch) -> 'stale') ? 'RULES_CHANGED' then raise exception 'FAIL(4): a rule approved after calculation must make the batch stale'; end if;
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'PAYROLL_BATCH_STALE');

  perform public.change_payroll_batch_status(v_batch, 'CALCULATED', 'send back: rule swap');
  v_c3 := pg_temp.to_approved(v_admin, v_batch);                                                                                 -- recalc picks set2, same 7%
  execute 'reset role';
  perform pg_temp.chk('A net after swap', pg_temp.tot(v_c3, v_a, 'net'), 10230000);
  if (select status from public.payroll_batches where id = v_batch) <> 'APPROVED' then raise exception 'FAIL(4): batch should be APPROVED'; end if;

  -- 5) approval facts, SoD recorded (same person did everything), lock -------------------------------------------------------
  if (select approved_at from public.payroll_batches where id = v_batch) is null
     or (select approved_calculation_id from public.payroll_batches where id = v_batch) <> v_c3 then raise exception 'FAIL(5): approval stamp'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  v_j := public.payroll_review_data(v_batch);
  if not (v_j -> 'sod' ->> 'approver_is_submitter')::boolean or not (v_j -> 'sod' ->> 'approver_is_reviewer')::boolean then
    raise exception 'FAIL(5): segregation-of-duties flags must be recorded';
  end if;
  if jsonb_array_length(v_j -> 'stale') <> 0 then raise exception 'FAIL(5): APPROVED batch must not report stale'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform pg_temp.expect_err(format('select public.calculate_payroll_batch(%L)', v_batch), 'INVALID_STATUS_TRANSITION');
  perform pg_temp.expect_err(format('select public.update_payroll_batch_settings(%L,%L,0,%L)', v_batch, 'TEST-P4', 'DOWN'), 'PAYROLL_BATCH_NOT_EDITABLE');
  perform pg_temp.expect_err(format('select public.save_payroll_work_data(%L,%L,p_work_days => 30)', v_period, v_a), 'PAYROLL_APPROVED_LOCKED');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L)', v_batch, 'UNDER_REVIEW'), 'PAYROLL_USE_REOPEN');
  select (r ->> 'locked')::boolean into strict v_lock from jsonb_array_elements(public.payroll_work_grid(v_period, v_batch)) r where r ->> 'personnel_id' = v_a::text;
  if not v_lock then raise exception 'FAIL(5): work grid must report A as locked'; end if;
  execute 'reset role';
  perform pg_temp.expect_err(format('update public.payroll_batches set approved_by = null where id = %L', v_batch), 'PAYROLL_APPROVED_LOCKED');
  perform pg_temp.expect_err(format('update public.payroll_batches set current_calculation_id = %L where id = %L', v_c1, v_batch), 'PAYROLL_APPROVED_LOCKED');
  perform pg_temp.expect_err(format('update public.payroll_results set net = 1 where calculation_id = %L', v_c3), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'INVALID_STATUS_TRANSITION');            -- already approved

  -- 6) account mapping: ADMIN only, accounts must be active + postable --------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.set_payroll_accounting_settings(%L,%L)', a_base, a_net), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform pg_temp.expect_err(format('select public.set_payroll_accounting_settings(%L,%L)', a_inactive, a_net), 'PAYROLL_ACCOUNT_INVALID');
  perform pg_temp.expect_err(format('select public.set_payroll_accounting_settings(%L,%L)', a_base, a_parent), 'PAYROLL_ACCOUNT_INVALID');
  perform pg_temp.expect_err(format('select public.set_payroll_component_accounts(%L,%L,null)', c_info, a_base), 'PAYROLL_ACCOUNT_INVALID');   -- INFORMATIONAL has no accounts
  perform pg_temp.expect_err(format('select public.set_payroll_component_accounts(%L,null,null)', c_ins), 'PAYROLL_ACCOUNT_INVALID');           -- DEDUCTION needs a liability account
  if jsonb_array_length(public.payroll_accounting_accounts()) < 6 then raise exception 'FAIL(6): postable account list too short'; end if;

  -- 7) accounting draft: both roles, mapping complete, base currency ---------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', null);
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'NOT_AUTHORIZED');                 -- no accounting role
  perform pg_temp.persona(v_admin, 'USER', null, null, 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'NOT_AUTHORIZED');                 -- no payroll role
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_ACCOUNT_MAPPING_MISSING');   -- nothing mapped yet

  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.set_payroll_accounting_settings(a_base, a_net);
  perform public.set_payroll_component_accounts(c_ins, null, a_ins);
  perform public.set_payroll_component_accounts(c_er, a_er_exp, a_er_liab);                                                          -- c_house deliberately NOT mapped yet
  v_j := public.payroll_accounting_readiness(v_batch);
  if not (v_j -> 'missing_components') @> '[{"code":"HOUSE_P4T"}]'::jsonb then raise exception 'FAIL(7): readiness must list the unmapped component (%)', v_j; end if;
  if not (v_j ->> 'settings_ok')::boolean or not (v_j ->> 'currency_ok')::boolean or not (v_j ->> 'can_draft')::boolean then raise exception 'FAIL(7): readiness flags (%)', v_j; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_ACCOUNT_MAPPING_MISSING');

  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.set_payroll_component_accounts(c_house, a_house, null);
  execute 'reset role';
  update public.app_settings set base_currency_code = 'USD' where id = 1;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_CURRENCY_NOT_BASE');
  execute 'reset role';
  update public.app_settings set base_currency_code = 'IRR' where id = 1;

  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  v_e1 := public.create_payroll_accounting_draft(v_batch);
  execute 'reset role';
  if (select status from public.journal_entries where id = v_e1) <> 'DRAFT' or (select document_number from public.journal_entries where id = v_e1) is not null then
    raise exception 'FAIL(7): the journal must be an unposted DRAFT';
  end if;
  select count(*) into v_n from public.journal_entry_lines where journal_entry_id = v_e1;
  if v_n <> 6 then raise exception 'FAIL(7): expected 6 aggregated lines (no per-employee lines), got %', v_n; end if;
  perform pg_temp.chk('debit total',  (select sum(debit)  from public.journal_entry_lines where journal_entry_id = v_e1), 17700000);
  perform pg_temp.chk('credit total', (select sum(credit) from public.journal_entry_lines where journal_entry_id = v_e1), 17700000);
  perform pg_temp.chk('Dr base',      pg_temp.jdebit(v_e1, 'T4-EXP-BASE'),  15000000);
  perform pg_temp.chk('Dr house',     pg_temp.jdebit(v_e1, 'T4-EXP-HOUSE'),  2000000);
  perform pg_temp.chk('Dr employer',  pg_temp.jdebit(v_e1, 'T4-EXP-ER'),      700000);
  perform pg_temp.chk('Cr employer',  pg_temp.jcredit(v_e1, 'T4-LIAB-ER'),    700000);
  perform pg_temp.chk('Cr insurance', pg_temp.jcredit(v_e1, 'T4-LIAB-INS'),   770000);
  perform pg_temp.chk('Cr net',       pg_temp.jcredit(v_e1, 'T4-LIAB-NET'),  16230000);
  select reference into v_txt from public.journal_entries where id = v_e1;
  select batch_number into v_bnum from public.payroll_batches where id = v_batch;
  if v_txt is distinct from v_bnum then raise exception 'FAIL(7): journal reference must be the batch number'; end if;
  if (select accounting_journal_entry_id from public.payroll_batches where id = v_batch) <> v_e1 then raise exception 'FAIL(7): batch link'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_ACCOUNTING_DRAFT_EXISTS');   -- idempotent

  -- 8) reopen: ADMIN + reason; blocked while a live journal is linked; works after Accounting deletes the draft ------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.reopen_payroll_batch(%L,%L)', v_batch, 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform pg_temp.expect_err(format('select public.reopen_payroll_batch(%L,%L)', v_batch, '  '), 'REASON_REQUIRED');
  perform pg_temp.expect_err(format('select public.reopen_payroll_batch(%L,%L)', v_batch, 'fix'), 'PAYROLL_REOPEN_BLOCKED');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L,%L)', v_batch, 'CANCELLED', 'x'), 'PAYROLL_REOPEN_BLOCKED');

  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');                             -- no accounting role
  perform pg_temp.expect_err(format('select public.discard_payroll_accounting_draft(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform public.discard_payroll_accounting_draft(v_batch);                              -- Accounting has no delete-draft path; payroll offers one
  perform pg_temp.expect_err(format('select public.discard_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_NO_ACCOUNTING_DRAFT');
  execute 'reset role';
  if (select accounting_journal_entry_id from public.payroll_batches where id = v_batch) is not null then raise exception 'FAIL(8): link must clear when the draft is discarded'; end if;
  if exists (select 1 from public.journal_entries where id = v_e1) or exists (select 1 from public.journal_entry_lines where journal_entry_id = v_e1) then
    raise exception 'FAIL(8): discarded draft (and its lines) must be gone';
  end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.reopen_payroll_batch(v_batch, 'phase4 test correction');
  execute 'reset role';
  if (select status from public.payroll_batches where id = v_batch) <> 'UNDER_REVIEW'
     or (select approved_at from public.payroll_batches where id = v_batch) is not null
     or (select reviewed_at from public.payroll_batches where id = v_batch) is not null then raise exception 'FAIL(8): reopen must clear approval + review stamps'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.save_payroll_work_data(v_period, v_a, p_work_days => 30);               -- unlocked again
  if not (public.payroll_review_data(v_batch) -> 'stale') ? 'WORK_DATA_CHANGED' then raise exception 'FAIL(8): edit after reopen must mark stale'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.change_payroll_batch_status(v_batch, 'CALCULATED', 'back to calculation');
  v_c4 := pg_temp.to_approved(v_admin, v_batch);

  -- 9) a REVERSED journal frees the batch for a new draft (post + reverse use Accounting's own RPCs) -----------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'POST');
  v_e2 := public.create_payroll_accounting_draft(v_batch);
  perform public.post_journal_entry(v_e2);
  perform pg_temp.expect_err(format('select public.discard_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_ACCOUNTING_NOT_DRAFT');   -- POSTED entries are never discarded
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_batch), 'PAYROLL_ACCOUNTING_DRAFT_EXISTS');   -- live (POSTED) journal
  perform public.reverse_journal_entry(v_e2);
  v_e3 := public.create_payroll_accounting_draft(v_batch);
  execute 'reset role';
  if v_e3 = v_e2 or (select status from public.journal_entries where id = v_e2) <> 'REVERSED' then raise exception 'FAIL(9): reversal flow'; end if;
  if (select accounting_journal_entry_id from public.payroll_batches where id = v_batch) <> v_e3 then raise exception 'FAIL(9): batch must link to the new draft'; end if;

  -- 10) confidentiality ----------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);                                -- HR-only
  select count(*) into v_n from (
    select 1 from public.payroll_accounting_settings union all select 1 from public.payroll_component_accounts
    union all select 1 from public.payroll_batches union all select 1 from public.payroll_results) t;
  if v_n <> 0 then raise exception 'FAIL(10): HR-only persona read % payroll rows', v_n; end if;
  perform pg_temp.expect_err(format('select public.approve_payroll_batch(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.payroll_accounting_readiness(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_accounting_accounts()', 'NOT_AUTHORIZED');

  perform pg_temp.persona(v_admin, 'USER', null, null, 'ADMIN');                           -- accounting-only: sees the journal, never payroll tables
  select count(*) into v_n from (select 1 from public.payroll_batches union all select 1 from public.payroll_results
                                 union all select 1 from public.payroll_result_lines union all select 1 from public.payroll_component_accounts) t;
  if v_n <> 0 then raise exception 'FAIL(10): accounting-only persona read % payroll rows', v_n; end if;
  select count(*) into v_n from public.journal_entry_lines where journal_entry_id = v_e3;
  if v_n <> 6 then raise exception 'FAIL(10): accounting user should see the 6 aggregated lines, got %', v_n; end if;
  perform pg_temp.expect_err(format('select public.payroll_accounting_readiness(%L)', v_batch), 'NOT_AUTHORIZED');

  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');                                 -- payroll-only: journal audit rows hidden (tg_audit copies amounts)
  select count(*) into v_n from public.activity_logs where entity_type in ('journal_entries','journal_entry_lines','journal_entry');
  if v_n <> 0 then raise exception 'FAIL(10): non-accounting user read % journal audit rows', v_n; end if;
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform pg_temp.expect_err(format('insert into public.payroll_component_accounts (component_id, component_type, expense_account_id) values (%L,%L,%L)', c_house, 'EARNING', a_house), 'permission denied');

  execute 'reset role';
  select count(*) into v_n from public.activity_logs
   where (entity_type like 'payroll\_%' escape '\' or (entity_type = 'journal_entries' and action = 'CREATED_FROM_PAYROLL_BATCH'))
     and (coalesce(old_value::text, '') || coalesce(new_value::text, ''))
         ~ '\y(17700000|16230000|10230000|770000|700000|15000000|6000000|11000000|2000000)\y';
  if v_n <> 0 then raise exception 'FAIL(10): % activity_logs rows contain amounts', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type = 'payroll_batches' and action in ('APPROVED','REOPENED','ACCOUNTING_DRAFT_CREATED');
  if v_n < 5 then raise exception 'FAIL(10): expected approval/reopen/draft log rows, got %', v_n; end if;

  -- 11) deferred constraints really hold at commit ------------------------------------------------------------------------------------------------------------------
  execute 'set constraints all immediate';

  raise notice 'PASS: payroll approval + accounting draft integrity checks';
end $$;

rollback;

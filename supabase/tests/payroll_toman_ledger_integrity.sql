-- =============================================================================
-- NIL Office — HR & Payroll Phase 9 (a TOMAN payroll batch may reach the books, migration 0140) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0140, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (period 1450/01, fiscal year 2071,
-- accounts 'T9-*', bank accounts 'T9 ...') and exists only inside the rollback; the real app_settings (base currency, display unit)
-- and the real accounting mapping are changed INSIDE the rolled-back transaction only. Real personnel are EXCLUDED from the fixture
-- batches through eligibility overrides.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Rule under test (accounting_ledger_currencies):
--   display_unit RIAL  (base IRR)        -> {IRR}            a TOMAN batch / bank account is refused (no silent x10)
--   display_unit TOMAN (base IRR|TOMAN)  -> {IRR, TOMAN}     batch and bank account in either code are accepted
--   base currency USD                    -> {USD}            an IRR / TOMAN batch is refused; USD is never a ledger-equivalent of IRR
-- Hand-computed: T (TOMAN batch) base 10,000,000 -> gross = net 10,000,000;  I (IRR batch) base 5,000,000 -> 5,000,000.
--   TOMAN batch journal: debit expense 10,000,000 / credit net payable 10,000,000.
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

create function pg_temp.set_units(p_base text, p_unit text) returns void language plpgsql as $$
begin
  execute 'reset role';
  update public.app_settings set base_currency_code = p_base, display_unit = p_unit where id = 1;
end $$;

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

-- payment drafts for ONE result through the payroll RPC (as payroll APPROVE + accounting CREATE)
create function pg_temp.draft_sql(p_batch uuid, p_bank uuid, p_result uuid, p_amount text) returns text language sql as $$
  select format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', p_batch, p_bank, date '2071-04-25',
                jsonb_build_array(jsonb_build_object('result_id', p_result, 'amount', p_amount))) $$;

do $$
declare
  v_admin uuid; v_t uuid; v_i uuid; v_ids uuid[]; v_others uuid[]; v_o uuid;
  v_period uuid; v_bt uuid; v_bi uuid; v_calc_t uuid; v_calc_i uuid; v_rt uuid; v_ri uuid; v_fy uuid; v_entry uuid; v_j jsonb;
  a_exp uuid; a_net uuid; a_gl uuid; k_irr uuid; k_tmn uuid; k_usd uuid; v_n integer;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  perform pg_temp.set_units('IRR', 'RIAL');
  update public.payroll_accounting_settings set base_salary_expense_account_id = null, net_payable_account_id = null;   -- (rolled back)

  -- 1) the helper itself ----------------------------------------------------------------------------------------------------------
  perform pg_temp.set_units('IRR', 'RIAL');
  if public.accounting_ledger_currencies() <> array['IRR'] then raise exception 'FAIL(1): RIAL -> {IRR}, got %', public.accounting_ledger_currencies(); end if;
  perform pg_temp.set_units('IRR', 'TOMAN');
  if public.accounting_ledger_currencies() <> array['IRR', 'TOMAN'] then raise exception 'FAIL(1): TOMAN/IRR -> {IRR,TOMAN}, got %', public.accounting_ledger_currencies(); end if;
  perform pg_temp.set_units('TOMAN', 'TOMAN');
  if public.accounting_ledger_currencies() <> array['IRR', 'TOMAN'] then raise exception 'FAIL(1): TOMAN/TOMAN -> {IRR,TOMAN}'; end if;
  perform pg_temp.set_units('TOMAN', 'RIAL');
  if public.accounting_ledger_currencies() <> array['TOMAN'] then raise exception 'FAIL(1): base TOMAN + RIAL -> {TOMAN}'; end if;
  perform pg_temp.set_units('USD', 'TOMAN');
  if public.accounting_ledger_currencies() <> array['USD'] then raise exception 'FAIL(1): base USD never widens'; end if;
  perform pg_temp.set_units('IRR', 'RIAL');

  -- 2) fixtures: one TOMAN person, one IRR person --------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_t := (public.onboard_personnel('الف', 'تست۹ت', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_i := (public.onboard_personnel('ب', 'تست۹ت',   date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_ids := array[v_t, v_i];
  perform public.create_compensation_version(v_t, date '2070-01-01', 10000000, 'TOMAN', 'MONTHLY');
  perform public.create_compensation_version(v_i, date '2070-01-01', 5000000,  'IRR',   'MONTHLY');
  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;

  execute 'reset role';
  insert into public.accounts (code, name, level, nature, account_type, is_active, allows_posting) values
    ('T9-EXP', 'test payroll expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T9-NET', 'test payroll payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T9-BANK-GL', 'test bank ledger', 1, 'DEBIT', 'ASSET', true, true);
  select id into a_exp from public.accounts where code = 'T9-EXP';
  select id into a_net from public.accounts where code = 'T9-NET';
  select id into a_gl  from public.accounts where code = 'T9-BANK-GL';
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T9 bank', 'T9 IRR account', 'IRR', a_gl, true) returning id into k_irr;
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T9 bank', 'T9 TOMAN account', 'TOMAN', a_gl, true) returning id into k_tmn;
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T9 bank', 'T9 USD account', 'USD', a_gl, true) returning id into k_usd;
  insert into public.fiscal_years (title, start_date, end_date, status) values ('TEST-P9', date '2071-03-01', date '2072-02-28', 'OPEN')
    returning id into v_fy;
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);

  -- 3) two APPROVED batches in the same period: TOMAN and IRR ------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_bt := (public.create_payroll_batch(v_period, 'TOMAN', 0, 'HALF_UP', null)).id;
  v_bi := (public.create_payroll_batch(v_period, 'IRR',   0, 'HALF_UP', null)).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_bt, v_o, 'EXCLUDE', 'phase9 test fixture isolation');
    perform public.set_payroll_eligibility_override(v_bi, v_o, 'EXCLUDE', 'phase9 test fixture isolation');
  end loop;
  v_calc_t := pg_temp.to_approved(v_admin, v_bt);
  v_calc_i := pg_temp.to_approved(v_admin, v_bi);
  execute 'reset role';
  select id into v_rt from public.payroll_results where calculation_id = v_calc_t and personnel_id = v_t;
  select id into v_ri from public.payroll_results where calculation_id = v_calc_i and personnel_id = v_i;
  perform pg_temp.chk('T net', (select net from public.payroll_results where id = v_rt), 10000000);
  perform pg_temp.chk('I net', (select net from public.payroll_results where id = v_ri), 5000000);
  if (select count(*) from public.payroll_results where calculation_id = v_calc_t and personnel_id = any(v_ids)) <> 1
     or (select count(*) from public.payroll_results where calculation_id = v_calc_i and personnel_id = any(v_ids)) <> 1 then
    raise exception 'FAIL(3): each batch holds only its own currency''s person';
  end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.set_payroll_accounting_settings(a_exp, a_net);

  -- 4) display unit RIAL: a TOMAN batch cannot reach the books; an IRR batch can ---------------------------------------------------------
  perform pg_temp.set_units('IRR', 'RIAL');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  v_j := public.payroll_accounting_readiness(v_bt);
  if (v_j ->> 'currency_ok')::boolean or v_j ->> 'display_unit' <> 'RIAL' or v_j -> 'ledger_currencies' <> '["IRR"]'::jsonb then raise exception 'FAIL(4): TOMAN readiness under RIAL (%)', v_j; end if;
  if not (public.payroll_accounting_readiness(v_bi) ->> 'currency_ok')::boolean then raise exception 'FAIL(4): IRR readiness under RIAL'; end if;
  perform pg_temp.expect_err(format('select public.create_payroll_accounting_draft(%L)', v_bt), 'PAYROLL_CURRENCY_NOT_BASE');
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bt, k_tmn, v_rt, '1000'), 'PAYROLL_CURRENCY_NOT_BASE');
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bt, k_irr, v_rt, '1000'), 'PAYROLL_CURRENCY_NOT_BASE');
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bi, k_tmn, v_ri, '1000'), 'PAYROLL_BANK_CURRENCY_MISMATCH');     -- no silent x10 either way
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bi, k_usd, v_ri, '1000'), 'PAYROLL_BANK_CURRENCY_MISMATCH');

  -- 5) display unit TOMAN: the TOMAN batch reaches the books, with a TOMAN- or an IRR-coded bank account ----------------------------------
  perform pg_temp.set_units('IRR', 'TOMAN');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  v_j := public.payroll_accounting_readiness(v_bt);
  if not (v_j ->> 'currency_ok')::boolean or v_j -> 'ledger_currencies' <> '["IRR", "TOMAN"]'::jsonb or not (v_j ->> 'settings_ok')::boolean or not (v_j ->> 'can_draft')::boolean then
    raise exception 'FAIL(5): TOMAN readiness under TOMAN (%)', v_j;
  end if;
  v_entry := public.create_payroll_accounting_draft(v_bt);
  select count(*) into v_n from public.journal_entry_lines where journal_entry_id = v_entry;
  if v_n <> 2 then raise exception 'FAIL(5): expected 2 journal lines, got %', v_n; end if;
  perform pg_temp.chk('journal debit',  (select coalesce(sum(debit), 0)  from public.journal_entry_lines where journal_entry_id = v_entry), 10000000);
  perform pg_temp.chk('journal credit', (select coalesce(sum(credit), 0) from public.journal_entry_lines where journal_entry_id = v_entry), 10000000);
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bt, k_usd, v_rt, '1000'), 'PAYROLL_BANK_CURRENCY_MISMATCH');     -- a foreign currency is never equivalent
  if public.create_payroll_payment_drafts(v_bt, k_irr, date '2071-04-25', null,
       jsonb_build_array(jsonb_build_object('result_id', v_rt, 'amount', '4000000'))) <> 1 then raise exception 'FAIL(5): draft with the IRR-coded bank'; end if;
  if public.create_payroll_payment_drafts(v_bt, k_tmn, date '2071-04-25', null,
       jsonb_build_array(jsonb_build_object('result_id', v_rt, 'amount', '6000000'))) <> 1 then raise exception 'FAIL(5): draft with the TOMAN-coded bank'; end if;
  execute 'reset role';
  perform pg_temp.chk('drafted total', (select coalesce(sum(p.amount), 0) from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_rt), 10000000);
  if (select count(*) from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_rt and p.currency_code = 'TOMAN') <> 2 then
    raise exception 'FAIL(5): the drafts carry the batch currency (no conversion, no relabel)';
  end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bt, k_tmn, v_rt, '1'), 'PAYROLL_PAYMENT_AMOUNT_INVALID');         -- nothing left to draft: the amount cap still holds

  -- 6) the IRR batch under display unit TOMAN: still works, with either bank code -------------------------------------------------------
  v_entry := public.create_payroll_accounting_draft(v_bi);
  perform pg_temp.chk('IRR journal debit', (select coalesce(sum(debit), 0) from public.journal_entry_lines where journal_entry_id = v_entry), 5000000);
  if public.create_payroll_payment_drafts(v_bi, k_tmn, date '2071-04-25', null,
       jsonb_build_array(jsonb_build_object('result_id', v_ri, 'amount', '5000000'))) <> 1 then raise exception 'FAIL(6): IRR batch with a TOMAN-coded bank'; end if;

  -- 7) switching back / another base: refused again, even for existing approved batches -------------------------------------------------
  perform pg_temp.set_units('IRR', 'RIAL');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bt, k_tmn, v_rt, '1'), 'PAYROLL_CURRENCY_NOT_BASE');
  perform pg_temp.set_units('USD', 'TOMAN');
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(pg_temp.draft_sql(v_bi, k_irr, v_ri, '1'), 'PAYROLL_CURRENCY_NOT_BASE');
  if (public.payroll_accounting_readiness(v_bi) ->> 'currency_ok')::boolean then raise exception 'FAIL(7): base USD must not accept an IRR batch'; end if;

  perform pg_temp.set_units('IRR', 'RIAL');
  raise notice 'PASS: payroll_toman_ledger_integrity (rolled back)';
end $$;

rollback;

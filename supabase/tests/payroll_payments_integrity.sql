-- =============================================================================
-- NIL Office — HR & Payroll Phase 5 (salary payments via Financial Receipts & Payments) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0129, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (period 1450/01,
-- fiscal year 2071, accounts 'T5-*', bank accounts 'T5 ...') and exists only inside the rollback. Real personnel are
-- EXCLUDED from the fixture batch through eligibility overrides.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
-- Hand-computed expectations (HALF_UP, scale 0, no deductions):
--   A: base 10,000,000 + house 1,000,000 = net 11,000,000     B: base 5,000,000 + house 1,000,000 = net 6,000,000
--   Partial flow: A pays 4,000,000 then 7,000,000; B pays 6,000,000 in one payment.
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

-- one field of one result row in a payment summary
create function pg_temp.sv(p_summary jsonb, p_result uuid, p_key text) returns text language sql as $$
  select r ->> p_key from jsonb_array_elements(p_summary -> 'rows') r where r ->> 'result_id' = p_result::text $$;

create function pg_temp.jdebit(p_entry uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit), 0) from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
   where l.journal_entry_id = p_entry and a.code = p_code $$;
create function pg_temp.jcredit(p_entry uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(l.credit), 0) from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
   where l.journal_entry_id = p_entry and a.code = p_code $$;

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

-- DRAFT payment for a result through the payroll RPC (as payroll APPROVE + accounting CREATE)
create function pg_temp.draft(p_user uuid, p_batch uuid, p_bank uuid, p_date date, p_result uuid, p_amount text) returns integer language plpgsql as $$
begin
  perform pg_temp.persona(p_user, 'USER', null, 'APPROVE', 'CREATE');
  return public.create_payroll_payment_drafts(p_batch, p_bank, p_date, null,
    jsonb_build_array(jsonb_build_object('result_id', p_result, 'amount', p_amount)));
end $$;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_ids uuid[]; v_others uuid[]; v_o uuid;
  c_house uuid; v_period uuid; v_batch uuid; v_calc uuid; v_fy uuid; v_ra uuid; v_rb uuid;
  a_exp uuid; a_net uuid; a_gl uuid;
  v_bank uuid; v_bank_usd uuid; v_bank_unlinked uuid; v_bank_inactive uuid;
  v_pa1 uuid; v_pb uuid; v_pa2 uuid; v_pa2b uuid; v_je uuid; v_n int; v_j jsonb; v_txt text; v_bnum text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  update public.app_settings set base_currency_code = 'IRR' where id = 1;   -- the fixture batch is IRR (rolled back)

  -- 1) fixtures (as ADMIN / superuser) ----------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست۵', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست۵', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_ids := array[v_a, v_b];
  c_house := (public.create_salary_component(p_code => 'HOUSE_P5T', p_component_type => 'EARNING', p_name_fa => 'مسکن',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000, p_currency => 'IRR')).component_id;
  perform public.create_compensation_version(v_a, date '2070-01-01', 10000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 5000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;

  execute 'reset role';
  insert into public.accounts (code, name, level, nature, account_type, is_active, allows_posting) values
    ('T5-EXP', 'test payroll expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T5-NET', 'test payroll payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T5-BANK-GL', 'test bank ledger', 1, 'DEBIT', 'ASSET', true, true);
  select id into a_exp from public.accounts where code = 'T5-EXP';
  select id into a_net from public.accounts where code = 'T5-NET';
  select id into a_gl  from public.accounts where code = 'T5-BANK-GL';
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T5 bank', 'T5 IRR account', 'IRR', a_gl, true) returning id into v_bank;
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T5 bank', 'T5 USD account', 'USD', a_gl, true) returning id into v_bank_usd;
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T5 bank', 'T5 unlinked account', 'IRR', null, true) returning id into v_bank_unlinked;
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T5 bank', 'T5 inactive account', 'IRR', a_gl, false) returning id into v_bank_inactive;
  insert into public.fiscal_years (title, start_date, end_date, status) values ('TEST-P5', date '2071-03-01', date '2072-02-28', 'OPEN')
    returning id into v_fy;
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);

  -- 2) batch -> APPROVED --------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', null)).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_batch, v_o, 'EXCLUDE', 'phase5 test fixture isolation');
  end loop;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_calc := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_calc and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_calc and personnel_id = v_b;
  perform pg_temp.chk('A net', (select net from public.payroll_results where id = v_ra), 11000000);
  perform pg_temp.chk('B net', (select net from public.payroll_results where id = v_rb), 6000000);

  -- 3) refusals: not approved / roles / settings / currency / bank / fiscal year / amounts -------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000')) ), 'PAYROLL_NOT_APPROVED');            -- still CALCULATED
  v_calc := pg_temp.to_approved(v_admin, v_batch);                                                                              -- (re-calculates: new calculation id)
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_calc and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_calc and personnel_id = v_b;
  if (select status from public.payroll_batches where id = v_batch) <> 'APPROVED' then raise exception 'FAIL(3): batch should be APPROVED'; end if;

  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', null);                                                              -- payroll only
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', null, null, 'CREATE');                                                               -- accounting only
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'NOT_AUTHORIZED');

  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'PAYROLL_ACCOUNT_MAPPING_MISSING');     -- net-payable account not configured yet
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.set_payroll_accounting_settings(a_exp, a_net);

  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank_unlinked, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'PAYROLL_BANK_ACCOUNT_INVALID');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank_inactive, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'PAYROLL_BANK_ACCOUNT_INVALID');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank_usd, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'PAYROLL_BANK_CURRENCY_MISMATCH');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2080-01-01',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'FISCAL_YEAR_CLOSED');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25', '[]'::jsonb), 'PAYROLL_NO_PAYMENTS');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '0'))), 'PAYROLL_PAYMENT_AMOUNT_INVALID');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '11000001'))), 'PAYROLL_PAYMENT_AMOUNT_INVALID');   -- more than A's net
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', gen_random_uuid(), 'amount', '1000'))), 'NOT_FOUND');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1'), jsonb_build_object('result_id', v_ra, 'amount', '2'))), 'INVALID_VALUE');
  execute 'reset role';
  update public.app_settings set base_currency_code = 'USD' where id = 1;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.create_payroll_payment_drafts(%L,%L,%L,null,%L)', v_batch, v_bank, date '2071-04-25',
            jsonb_build_array(jsonb_build_object('result_id', v_ra, 'amount', '1000'))), 'PAYROLL_CURRENCY_NOT_BASE');
  execute 'reset role';
  update public.app_settings set base_currency_code = 'IRR' where id = 1;

  -- 4) drafts: A pays 4,000,000 of 11,000,000 (partial) and B pays all 6,000,000 -------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  v_n := public.create_payroll_payment_drafts(v_batch, v_bank, date '2071-04-25', null, jsonb_build_array(
           jsonb_build_object('result_id', v_ra, 'amount', '4000000'), jsonb_build_object('result_id', v_rb, 'amount', '6000000')));
  if v_n <> 2 then raise exception 'FAIL(4): expected 2 drafts, got %', v_n; end if;
  execute 'reset role';
  select p.id into v_pa1 from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_ra;
  select p.id into v_pb  from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_rb;
  select batch_number into v_bnum from public.payroll_batches where id = v_batch;
  if (select count(*) from public.payments where id in (v_pa1, v_pb) and status = 'DRAFT' and counterpart_account_id = a_net
         and bank_account_id = v_bank and reference = v_bnum and currency_code = 'IRR' and fiscal_year_id = v_fy) <> 2 then
    raise exception 'FAIL(4): payment drafts must be DRAFT, Dr payroll-payable account, on the chosen bank, with the batch reference';
  end if;
  if (select payee from public.payments where id = v_pa1) <> 'الف تست۵' then raise exception 'FAIL(4): payee must be the employee full name'; end if;
  if (select count(*) from public.payments where id in (v_pa1, v_pb) and (description ~ '[0-9]{6,}' or description ~ '(4000000|6000000)')) <> 0 then
    raise exception 'FAIL(4): payment descriptions must not carry amounts';
  end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_payment_summary(v_batch);
  if v_j ->> 'payment_state' <> 'DRAFTED' then raise exception 'FAIL(4): state should be DRAFTED, got %', v_j ->> 'payment_state'; end if;
  perform pg_temp.chk('A drafted',   pg_temp.sv(v_j, v_ra, 'drafted')::numeric,   4000000);
  perform pg_temp.chk('A available', pg_temp.sv(v_j, v_ra, 'available')::numeric, 7000000);
  perform pg_temp.chk('A paid',      pg_temp.sv(v_j, v_ra, 'paid')::numeric,      0);
  perform pg_temp.chk('B available', pg_temp.sv(v_j, v_rb, 'available')::numeric, 0);
  -- drafts reserve the amount: another 7,000,001 on A is refused, 7,000,000 would be fine
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select pg_temp.draft(%L,%L,%L,%L,%L,%L)', v_admin, v_batch, v_bank, date '2071-04-26', v_ra, '7000001'), 'PAYROLL_PAYMENT_AMOUNT_INVALID');

  -- link rows are immutable; the batch stays locked while payments are live -----------------------------------------------------------
  execute 'reset role';
  perform pg_temp.expect_err(format('update public.payroll_payments set amount_snapshot = 1 where payment_id = %L', v_pa1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('delete from public.payroll_payments where payment_id = %L', v_pa1), 'PAYROLL_NO_DELETE');
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform pg_temp.expect_err(format('select public.reopen_payroll_batch(%L,%L)', v_batch, 'fix'), 'PAYROLL_REOPEN_BLOCKED');
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L,%L)', v_batch, 'CANCELLED', 'x'), 'PAYROLL_REOPEN_BLOCKED');

  -- 5) Accounting verifies + posts with ITS OWN flow; payroll only DERIVES the state ---------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.verify_payment(v_pa1);
  perform public.verify_payment(v_pb);
  perform public.post_payment(v_pa1);
  perform public.post_payment(v_pb);
  execute 'reset role';
  perform pg_temp.chk('Dr payable A1', pg_temp.jdebit((select journal_entry_id from public.payments where id = v_pa1), 'T5-NET'), 4000000);
  perform pg_temp.chk('Cr bank A1',    pg_temp.jcredit((select journal_entry_id from public.payments where id = v_pa1), 'T5-BANK-GL'), 4000000);
  perform pg_temp.chk('Dr payable B',  pg_temp.jdebit((select journal_entry_id from public.payments where id = v_pb), 'T5-NET'), 6000000);
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_payment_summary(v_batch);
  if v_j ->> 'payment_state' <> 'PARTIALLY_PAID' then raise exception 'FAIL(5): state should be PARTIALLY_PAID, got %', v_j ->> 'payment_state'; end if;
  perform pg_temp.chk('A paid',        pg_temp.sv(v_j, v_ra, 'paid')::numeric,        4000000);
  perform pg_temp.chk('A outstanding', pg_temp.sv(v_j, v_ra, 'outstanding')::numeric, 7000000);
  perform pg_temp.chk('B paid',        pg_temp.sv(v_j, v_rb, 'paid')::numeric,        6000000);
  perform pg_temp.chk('B outstanding', pg_temp.sv(v_j, v_rb, 'outstanding')::numeric, 0);
  perform pg_temp.chk('total paid',    (v_j -> 'totals' ->> 'paid')::numeric,          10000000);
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select public.discard_payroll_payment_drafts(%L)', v_batch), 'PAYROLL_NO_PAYMENTS');         -- POSTED payments are never discarded
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform pg_temp.expect_err(format('select public.reopen_payroll_batch(%L,%L)', v_batch, 'fix'), 'PAYROLL_REOPEN_BLOCKED');

  -- 6) remainder: draft -> discard -> draft again -> post => PAID ----------------------------------------------------------------------------------
  if pg_temp.draft(v_admin, v_batch, v_bank, date '2071-04-26', v_ra, '7000000') <> 1 then raise exception 'FAIL(6): draft'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  if public.discard_payroll_payment_drafts(v_batch) <> 1 then raise exception 'FAIL(6): discard should remove exactly the one DRAFT'; end if;
  execute 'reset role';
  if (select count(*) from public.payroll_payments where batch_id = v_batch) <> 2 then raise exception 'FAIL(6): the POSTED payments and their links must remain'; end if;
  if (select count(*) from public.payments where status = 'POSTED' and id in (v_pa1, v_pb)) <> 2 then raise exception 'FAIL(6): posted payments must be untouched'; end if;
  if pg_temp.draft(v_admin, v_batch, v_bank, date '2071-04-26', v_ra, '7000000') <> 1 then raise exception 'FAIL(6): draft again'; end if;
  execute 'reset role';
  select p.id into v_pa2 from public.payments p join public.payroll_payments pp on pp.payment_id = p.id
   where pp.result_id = v_ra and p.status = 'DRAFT';
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.verify_payment(v_pa2);
  perform public.post_payment(v_pa2);
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_payment_summary(v_batch);
  if v_j ->> 'payment_state' <> 'PAID' then raise exception 'FAIL(6): state should be PAID, got %', v_j ->> 'payment_state'; end if;
  perform pg_temp.chk('A outstanding', pg_temp.sv(v_j, v_ra, 'outstanding')::numeric, 0);
  perform pg_temp.chk('A paid',        pg_temp.sv(v_j, v_ra, 'paid')::numeric,        11000000);
  perform pg_temp.chk('total outstanding', (v_j -> 'totals' ->> 'outstanding')::numeric, 0);
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  perform pg_temp.expect_err(format('select pg_temp.draft(%L,%L,%L,%L,%L,%L)', v_admin, v_batch, v_bank, date '2071-04-27', v_ra, '1'), 'PAYROLL_PAYMENT_AMOUNT_INVALID');   -- nothing left to pay

  -- 7) a REVERSED payment journal no longer counts as paid ----------------------------------------------------------------------------------------
  execute 'reset role';
  select journal_entry_id into v_je from public.payments where id = v_pa2;
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.reverse_journal_entry(v_je);
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_payment_summary(v_batch);
  if v_j ->> 'payment_state' <> 'PARTIALLY_PAID' then raise exception 'FAIL(7): a reversed payment journal must reopen the balance (state %)', v_j ->> 'payment_state'; end if;
  perform pg_temp.chk('A paid after reversal',      pg_temp.sv(v_j, v_ra, 'paid')::numeric,      4000000);
  perform pg_temp.chk('A available after reversal', pg_temp.sv(v_j, v_ra, 'available')::numeric, 7000000);

  -- 8) a payment edited after drafting is flagged (accounting RLS allows edits) -----------------------------------------------------------------------
  execute 'reset role';
  update public.payments set amount = amount + 1 where id = v_pb;
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_payment_summary(v_batch);
  if pg_temp.sv(v_j, v_rb, 'amount_changed')::boolean is not true or pg_temp.sv(v_j, v_rb, 'overpaid')::boolean is not true then
    raise exception 'FAIL(8): edited amount must raise amount_changed and overpaid (%)', v_j;
  end if;

  -- 9) confidentiality -------------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);                                  -- HR-only
  select count(*) into v_n from public.payroll_payments;
  if v_n <> 0 then raise exception 'FAIL(9): HR-only persona read % payroll payment rows', v_n; end if;
  perform pg_temp.expect_err(format('select public.payroll_payment_summary(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_bank_accounts()', 'NOT_AUTHORIZED');

  perform pg_temp.persona(v_admin, 'USER', null, null, 'ADMIN');                            -- accounting-only
  select count(*) into v_n from public.payroll_payments;
  if v_n <> 0 then raise exception 'FAIL(9): accounting-only persona read % payroll payment rows', v_n; end if;
  perform pg_temp.expect_err(format('select public.payroll_payment_summary(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.discard_payroll_payment_drafts(%L)', v_batch), 'NOT_AUTHORIZED');

  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');                                  -- payroll-only: no payments table, no payment/journal audit rows
  select count(*) into v_n from public.payments;
  if v_n <> 0 then raise exception 'FAIL(9): payroll-only persona read % payments', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type in ('payments','payment','receipts','receipt','journal_entries','journal_entry_lines','journal_entry');
  if v_n <> 0 then raise exception 'FAIL(9): payroll-only persona read % payment/journal audit rows', v_n; end if;
  v_j := public.payroll_bank_accounts();
  if jsonb_array_length(v_j) < 1 or (v_j -> 0) ? 'account_number' or (v_j -> 0) ? 'iban' then raise exception 'FAIL(9): bank list must exist and expose no account numbers'; end if;
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  perform pg_temp.expect_err(format('insert into public.payroll_payments (batch_id, result_id, payment_id, amount_snapshot, currency, created_by) values (%L,%L,%L,1,%L,%L)', v_batch, v_ra, v_pa1, 'IRR', v_admin), 'permission denied');

  execute 'reset role';
  select count(*) into v_n from public.activity_logs
   where entity_type like 'payroll\_%' escape '\'
     and (coalesce(old_value::text, '') || coalesce(new_value::text, '')) ~ '\y(4000000|6000000|7000000|11000000|17000000|10000000|5000000)\y';
  if v_n <> 0 then raise exception 'FAIL(9): % payroll activity_logs rows contain amounts', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type = 'payroll_batches' and action in ('PAYMENT_DRAFTS_CREATED','PAYMENT_DRAFTS_DISCARDED');
  if v_n < 4 then raise exception 'FAIL(9): expected payment draft log rows, got %', v_n; end if;

  -- 10) deferred constraints really hold at commit ------------------------------------------------------------------------------------------------------
  execute 'set constraints all immediate';

  raise notice 'PASS: payroll payments integrity checks';
end $$;

rollback;

-- =============================================================================
-- NIL Office — HR & Payroll Phase 7 (dashboards + reports) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0132, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (period 1450/01,
-- fiscal year 2071, accounts 'T7-*', bank 'T7 ...') and exists only inside the rollback. Real personnel are EXCLUDED from the
-- fixture batches through eligibility overrides; the real accounting mapping is blanked INSIDE the rolled-back transaction.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
-- Hand-computed expectations:
--   IRR batch (APPROVED): A base 10,000,000 + house 1,000,000 = 11,000,000; B 5,000,000 + 1,000,000 = 6,000,000 -> net 17,000,000, no deductions.
--   USD batch (CALCULATED, scale 2): F base 1,000 USD -> net 1000.00.   Currencies must NEVER be summed.
--   A pays 4,000,000 (posted) -> paid 4,000,000 / outstanding 13,000,000 (batch) / A outstanding 7,000,000.
--   Accounting draft: Dr base 15,000,000 + Dr house 2,000,000 / Cr payroll payable 17,000,000.
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
  v_admin uuid; v_a uuid; v_b uuid; v_f uuid; v_ids uuid[]; v_others uuid[]; v_o uuid;
  c_house uuid; v_period uuid; v_batch uuid; v_usd uuid; v_calc uuid; v_fy uuid; v_ra uuid; v_rb uuid;
  a_exp uuid; a_house uuid; a_net uuid; a_gl uuid; v_bank uuid; v_p1 uuid; v_je uuid;
  v_j jsonb; v_x jsonb; v_n int; v_n0 int; v_sa uuid := gen_random_uuid(); v_path text;
  v_sha text := repeat('b', 64);
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  update public.app_settings set base_currency_code = 'IRR' where id = 1;
  update public.payroll_accounting_settings set base_salary_expense_account_id = null, net_payable_account_id = null;

  -- 1) fixtures --------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست۷', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست۷', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_f := (public.onboard_personnel('و', 'تست۷', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_ids := array[v_a, v_b, v_f];
  v_path := 'payslips/' || v_a || '/' || v_sa || '.pdf';
  c_house := (public.create_salary_component(p_code => 'HOUSE_P7T', p_component_type => 'EARNING', p_name_fa => 'مسکن',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000, p_currency => 'IRR')).component_id;
  perform public.create_compensation_version(v_a, date '2070-01-01', 10000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 5000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  perform public.create_compensation_version(v_f, date '2070-01-01', 1000, 'USD', 'MONTHLY');
  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;

  execute 'reset role';
  insert into public.accounts (code, name, level, nature, account_type, is_active, allows_posting) values
    ('T7-EXP', 'test payroll expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T7-HOUSE', 'test housing expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T7-NET', 'test payroll payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T7-BANK-GL', 'test bank ledger', 1, 'DEBIT', 'ASSET', true, true);
  select id into a_exp from public.accounts where code = 'T7-EXP';
  select id into a_house from public.accounts where code = 'T7-HOUSE';
  select id into a_net from public.accounts where code = 'T7-NET';
  select id into a_gl  from public.accounts where code = 'T7-BANK-GL';
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T7 bank', 'T7 IRR account', 'IRR', a_gl, true) returning id into v_bank;
  insert into public.fiscal_years (title, start_date, end_date, status) values ('TEST-P7', date '2071-03-01', date '2072-02-28', 'OPEN')
    returning id into v_fy;
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);

  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', null)).id;
  v_usd   := (public.create_payroll_batch(v_period, 'USD', 2, 'HALF_UP', null)).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_batch, v_o, 'EXCLUDE', 'phase7 test fixture isolation');
    perform public.set_payroll_eligibility_override(v_usd,   v_o, 'EXCLUDE', 'phase7 test fixture isolation');
  end loop;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.calculate_payroll_batch(v_usd);                                  -- USD stays CALCULATED (basis CALCULATED)
  v_calc := pg_temp.to_approved(v_admin, v_batch);                                -- IRR -> APPROVED
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_calc and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_calc and personnel_id = v_b;

  -- accounting mapping + DRAFT journal, then a partial payment of A (posted through Accounting's own RPCs)
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.set_payroll_accounting_settings(a_exp, a_net);
  perform public.set_payroll_component_accounts(c_house, a_house, null);
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE', 'CREATE');
  v_je := public.create_payroll_accounting_draft(v_batch);
  if pg_temp.draft(v_admin, v_batch, v_bank, date '2071-04-25', v_ra, '4000000') <> 1 then raise exception 'FAIL(1): payment draft'; end if;
  execute 'reset role';
  select p.id into v_p1 from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_ra and p.status = 'DRAFT';
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.verify_payment(v_p1);
  perform public.post_payment(v_p1);

  -- 2) register: exact text amounts, per-currency totals that are NEVER summed ---------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_report_register(v_period);
  if jsonb_array_length(v_j -> 'rows') <> 3 then raise exception 'FAIL(2): register must list A, B and F (got %)', jsonb_array_length(v_j -> 'rows'); end if;
  if jsonb_array_length(v_j -> 'totals') <> 2 then raise exception 'FAIL(2): totals must be one row per currency (got %)', v_j -> 'totals'; end if;
  perform pg_temp.chk('IRR net total', (select (t ->> 'net')::numeric from jsonb_array_elements(v_j -> 'totals') t where t ->> 'currency' = 'IRR'), 17000000);
  perform pg_temp.chk('USD net total', (select (t ->> 'net')::numeric from jsonb_array_elements(v_j -> 'totals') t where t ->> 'currency' = 'USD'), 1000);
  if (select count(*) from jsonb_array_elements(v_j -> 'rows') r where r ->> 'gross' !~ '^[0-9]+\.[0-9]{4}$') <> 0 then raise exception 'FAIL(2): amounts must be exact numeric text'; end if;
  if (select r ->> 'basis' from jsonb_array_elements(v_j -> 'rows') r where r ->> 'personnel_name' = 'الف تست۷') <> 'APPROVED' then raise exception 'FAIL(2): A basis'; end if;
  if (select r ->> 'basis' from jsonb_array_elements(v_j -> 'rows') r where r ->> 'currency' = 'USD') <> 'CALCULATED' then raise exception 'FAIL(2): USD batch basis must be CALCULATED'; end if;
  v_x := public.payroll_report_register(v_period, 'USD');
  if jsonb_array_length(v_x -> 'rows') <> 1 or jsonb_array_length(v_x -> 'totals') <> 1 then raise exception 'FAIL(2): currency filter'; end if;

  -- 3) by period (also gross/net + employer cost): one row per (period, currency) ----------------------------------------------
  v_j := public.payroll_report_by_period(1450, 1, 1450, 1);
  if jsonb_array_length(v_j -> 'rows') <> 2 then raise exception 'FAIL(3): expected one IRR row and one USD row (got %)', v_j -> 'rows'; end if;
  perform pg_temp.chk('IRR period gross', (select (r ->> 'gross')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'currency' = 'IRR'), 17000000);
  perform pg_temp.chk('IRR period paid', (select (r ->> 'paid')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'currency' = 'IRR'), 4000000);
  perform pg_temp.chk('IRR period outstanding', (select (r ->> 'outstanding')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'currency' = 'IRR'), 13000000);
  if (select (r ->> 'outstanding') from jsonb_array_elements(v_j -> 'rows') r where r ->> 'currency' = 'USD') is not null then raise exception 'FAIL(3): a not-yet-approved currency has no outstanding'; end if;
  if jsonb_array_length(public.payroll_report_by_period(1449, 1, 1449, 12) -> 'rows') <> 0 then raise exception 'FAIL(3): range filter'; end if;
  if jsonb_array_length(public.payroll_report_by_period(1450, 1, 1450, 1, 'USD') -> 'rows') <> 1 then raise exception 'FAIL(3): currency filter'; end if;

  -- 4) by personnel / components / compensation history / options -----------------------------------------------------------------
  v_j := public.payroll_report_by_personnel(v_a);
  if jsonb_array_length(v_j -> 'rows') <> 1 then raise exception 'FAIL(4): A has one payroll row (got %)', v_j; end if;
  perform pg_temp.chk('A net', (v_j -> 'rows' -> 0 ->> 'net')::numeric, 11000000);
  perform pg_temp.chk('A paid', (v_j -> 'rows' -> 0 ->> 'paid')::numeric, 4000000);
  perform pg_temp.expect_err('select public.payroll_report_by_personnel(null)', 'INVALID_VALUE');
  v_j := public.payroll_report_components(v_period, 'IRR');
  perform pg_temp.chk('house total', (select (r ->> 'total')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'component_code' = 'HOUSE_P7T'), 2000000);
  perform pg_temp.chk('house persons', (select (r ->> 'personnel_count')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'component_code' = 'HOUSE_P7T'), 2);
  perform pg_temp.chk('base total IRR', (select (r ->> 'total')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'component_code' = 'BASE_SALARY'), 15000000);
  if exists (select 1 from jsonb_array_elements(public.payroll_report_components(v_period, 'IRR') -> 'rows') r where r ->> 'currency' <> 'IRR') then raise exception 'FAIL(4): component currency filter'; end if;
  v_j := public.payroll_report_compensation_history(v_a);
  if jsonb_array_length(v_j -> 'rows') <> 1 then raise exception 'FAIL(4): compensation history rows'; end if;
  perform pg_temp.chk('A base salary', (v_j -> 'rows' -> 0 ->> 'base_salary')::numeric, 10000000);
  if not exists (select 1 from jsonb_array_elements(public.payroll_report_personnel_options()) o where o ->> 'id' = v_a::text) then raise exception 'FAIL(4): personnel options must include A'; end if;

  -- 5) payments status / outstanding (APPROVED batches only) ---------------------------------------------------------------------
  v_j := public.payroll_report_payments(v_period);
  if jsonb_array_length(v_j -> 'rows') <> 2 then raise exception 'FAIL(5): only the APPROVED IRR batch has payments (got %)', jsonb_array_length(v_j -> 'rows'); end if;
  perform pg_temp.chk('A outstanding', (select (r ->> 'outstanding')::numeric from jsonb_array_elements(v_j -> 'rows') r where r ->> 'personnel_name' = 'الف تست۷'), 7000000);
  if (select r ->> 'payment_state' from jsonb_array_elements(v_j -> 'rows') r where r ->> 'personnel_name' = 'الف تست۷') <> 'PARTIALLY_PAID' then raise exception 'FAIL(5): A state'; end if;
  if (select r ->> 'payment_state' from jsonb_array_elements(v_j -> 'rows') r where r ->> 'personnel_name' = 'ب تست۷') <> 'NOT_PAID' then raise exception 'FAIL(5): B state'; end if;
  perform pg_temp.chk('IRR outstanding total', (v_j -> 'totals' -> 0 ->> 'outstanding')::numeric, 13000000);
  v_x := public.payroll_report_payments(v_period, null, true);
  if jsonb_array_length(v_x -> 'rows') <> 2 then raise exception 'FAIL(5): outstanding report must list A and B'; end if;

  -- 6) reconciliation: DRAFT journal -> posted -> tampered credit ------------------------------------------------------------------
  v_j := public.payroll_report_reconciliation(v_period);
  if jsonb_array_length(v_j -> 'rows') <> 1 then raise exception 'FAIL(6): one APPROVED batch expected'; end if;
  perform pg_temp.chk('journal net credit', (v_j -> 'rows' -> 0 ->> 'journal_net_credit')::numeric, 17000000);
  perform pg_temp.chk('net difference', (v_j -> 'rows' -> 0 ->> 'net_difference')::numeric, 0);
  if not (v_j -> 'rows' -> 0 -> 'flags') ? 'JOURNAL_NOT_POSTED' then raise exception 'FAIL(6): draft journal must be flagged (%)', v_j -> 'rows' -> 0 -> 'flags'; end if;
  if (v_j -> 'rows' -> 0 -> 'flags') ? 'NET_PAYABLE_MISMATCH' or (v_j -> 'rows' -> 0 -> 'flags') ? 'JOURNAL_MISSING' then raise exception 'FAIL(6): unexpected flags'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.post_journal_entry(v_je);
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_report_reconciliation(v_period);
  if (v_j -> 'rows' -> 0 -> 'flags') ? 'JOURNAL_NOT_POSTED' or (v_j -> 'rows' -> 0 ->> 'journal_status') <> 'POSTED' then raise exception 'FAIL(6): posted journal (%)', v_j -> 'rows' -> 0; end if;
  execute 'reset role';
  perform set_config('nil.acc_guard', 'on', true);                                   -- simulate drift in the posted ledger
  update public.journal_entry_lines set credit = credit + 1 where journal_entry_id = v_je and account_id = a_net;
  perform set_config('nil.acc_guard', 'off', true);
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_report_reconciliation(v_period);
  if not (v_j -> 'rows' -> 0 -> 'flags') ? 'NET_PAYABLE_MISMATCH' then raise exception 'FAIL(6): tampered journal must raise NET_PAYABLE_MISMATCH (%)', v_j -> 'rows' -> 0; end if;
  perform pg_temp.chk('difference after drift', (v_j -> 'rows' -> 0 ->> 'net_difference')::numeric, -1);

  -- 7) payslip coverage ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.register_payroll_payslip(v_ra, v_sa, v_path, 'a-r1.pdf', 1000, v_sha, 'PARTIALLY_PAID');
  v_j := public.payroll_report_payslips(v_period);
  if jsonb_array_length(v_j -> 'rows') <> 2 then raise exception 'FAIL(7): payslip report covers the APPROVED batch only'; end if;
  if not (select (r ->> 'up_to_date')::boolean from jsonb_array_elements(v_j -> 'rows') r where r ->> 'personnel_name' = 'الف تست۷') then raise exception 'FAIL(7): A payslip must be up to date'; end if;
  if (select (r ->> 'issued')::boolean from jsonb_array_elements(v_j -> 'rows') r where r ->> 'personnel_name' = 'ب تست۷') then raise exception 'FAIL(7): B has no payslip'; end if;

  -- 8) dashboard: per-currency cards, pipeline, gaps (work data) -------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.payroll_dashboard(v_period);
  if jsonb_array_length(v_j -> 'currencies') <> 2 then raise exception 'FAIL(8): one card per currency (got %)', v_j -> 'currencies'; end if;
  perform pg_temp.chk('dash IRR net', (select (c ->> 'net')::numeric from jsonb_array_elements(v_j -> 'currencies') c where c ->> 'currency' = 'IRR'), 17000000);
  perform pg_temp.chk('dash IRR paid', (select (c ->> 'paid')::numeric from jsonb_array_elements(v_j -> 'currencies') c where c ->> 'currency' = 'IRR'), 4000000);
  perform pg_temp.chk('dash IRR outstanding', (select (c ->> 'outstanding')::numeric from jsonb_array_elements(v_j -> 'currencies') c where c ->> 'currency' = 'IRR'), 13000000);
  perform pg_temp.chk('dash USD net', (select (c ->> 'net')::numeric from jsonb_array_elements(v_j -> 'currencies') c where c ->> 'currency' = 'USD'), 1000);
  if (v_j -> 'pipeline' ->> 'approved')::int < 1 or (v_j -> 'pipeline' ->> 'pending_payment')::int < 1 or (v_j -> 'pipeline' ->> 'calculated')::int < 1 then raise exception 'FAIL(8): pipeline counts (%)', v_j -> 'pipeline'; end if;
  v_n0 := (v_j -> 'gaps' ->> 'missing_work_data')::int;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform public.save_payroll_work_data(v_period, v_f, p_work_days => 30);               -- F (USD batch still CALCULATED) is not locked; A and B are
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_n := (public.payroll_dashboard(v_period) -> 'gaps' ->> 'missing_work_data')::int;
  if v_n <> v_n0 - 1 then raise exception 'FAIL(8): saving work data must reduce the missing-work-data count by one (% -> %)', v_n0, v_n; end if;

  -- 9) cancelled batches never appear -----------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform public.change_payroll_batch_status(v_usd, 'CANCELLED', 'phase7 test');
  v_j := public.payroll_report_register(v_period);
  if jsonb_array_length(v_j -> 'rows') <> 2 or jsonb_array_length(v_j -> 'totals') <> 1 then raise exception 'FAIL(9): cancelled USD batch must disappear (%)', v_j -> 'totals'; end if;
  if jsonb_array_length(public.payroll_dashboard(v_period) -> 'currencies') <> 1 then raise exception 'FAIL(9): dashboard must drop the cancelled currency'; end if;

  -- 10) gates: HR-only never sees salary; counts-only gaps; accounting-only sees nothing -------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  perform pg_temp.expect_err(format('select public.payroll_dashboard(%L)', v_period), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.payroll_report_register(%L)', v_period), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_report_by_period()', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.payroll_report_by_personnel(%L)', v_a), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.payroll_report_components(%L)', v_period), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_report_payments()', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_report_reconciliation()', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_report_payslips()', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_report_compensation_history()', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.payroll_report_personnel_options()', 'NOT_AUTHORIZED');
  v_j := public.hr_payroll_gaps();
  if (select array_agg(k order by k) from jsonb_object_keys(v_j) k) is distinct from array['missing_compensation','missing_work_data','period'] then raise exception 'FAIL(10): gaps must expose counts only (%)', v_j; end if;
  if v_j::text ~ '[0-9]+\.[0-9]{4}' then raise exception 'FAIL(10): gaps must contain no amounts'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, null, 'ADMIN');
  perform pg_temp.expect_err(format('select public.payroll_dashboard(%L)', v_period), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.hr_payroll_gaps()', 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  v_j := public.hr_payroll_gaps();                                                   -- payroll users may call it too
  if (v_j ->> 'missing_compensation') is null then raise exception 'FAIL(10): payroll user gaps'; end if;

  -- 11) export audit: gated by family, one row per export, no amounts, invisible to the other family ---------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  perform public.record_report_export('hr_personnel_register', 12);
  perform pg_temp.expect_err('select public.record_report_export(''payroll_register'', 3)', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.record_report_export(''Bad Key!'', 3)', 'INVALID_VALUE');
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  perform public.record_report_export('payroll_register', 3);
  perform pg_temp.expect_err('select public.record_report_export(''hr_personnel_register'', 3)', 'NOT_AUTHORIZED');
  select count(*) into v_n from public.activity_logs where entity_type = 'payroll_reports' and created_at = now();
  if v_n <> 1 then raise exception 'FAIL(11): payroll user must see exactly the payroll export row (got %)', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type = 'hr_reports';
  if v_n <> 0 then raise exception 'FAIL(11): payroll-only user read % HR export rows', v_n; end if;
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  select count(*) into v_n from public.activity_logs where entity_type = 'payroll_reports';
  if v_n <> 0 then raise exception 'FAIL(11): HR-only user read % payroll export rows', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type = 'hr_reports' and created_at = now();
  if v_n <> 1 then raise exception 'FAIL(11): HR user must see exactly the HR export row (got %)', v_n; end if;
  execute 'reset role';
  select count(*) into v_n from public.activity_logs
   where entity_type in ('payroll_reports','hr_reports') and created_at = now()
     and (coalesce(new_value::text, '') ~ '[0-9]+\.[0-9]{4}' or new_value::text !~ '"report"');
  if v_n <> 0 then raise exception 'FAIL(11): export log rows must carry report key + row count only'; end if;

  execute 'set constraints all immediate';
  raise notice 'PASS: payroll reports integrity checks';
end $$;

rollback;

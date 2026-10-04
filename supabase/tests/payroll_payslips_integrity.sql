-- =============================================================================
-- NIL Office — HR & Payroll Phase 6 (payslips: archive, revisions, self-service, IDOR) integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0131, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (period 1450/01,
-- fiscal year 2071, accounts 'T6-*', bank 'T6 ...', storage.objects rows under payslips/ — all rolled back).
-- Real personnel are EXCLUDED from the fixture batch through eligibility overrides; the real accounting mapping is blanked
-- INSIDE the rolled-back transaction (UPDATE; the table has a no-delete trigger).
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
-- Hand-computed expectations (HALF_UP, scale 0, no deductions):
--   A: base 10,000,000 + house 1,000,000 + hidden bonus 500,000 (display_on_payslip=false) = net 11,500,000
--   B: base 5,000,000 + house 1,000,000 = net 6,000,000
--   Payslip lines for A = BASE, HOUSE and a folded «سایر مزایا» 500,000 (so visible lines still reconcile with the total).
--   A revisions: 1 NOT_PAID -> (4,000,000 posted) 2 PARTIALLY_PAID -> (7,500,000 posted) 3 PAID.
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
  c_house uuid; c_hid uuid; v_period uuid; v_batch uuid; v_calc uuid; v_fy uuid; v_ra uuid; v_rb uuid;
  a_exp uuid; a_net uuid; a_gl uuid; v_bank uuid;
  s_a1 uuid := gen_random_uuid(); s_a2 uuid := gen_random_uuid(); s_a3 uuid := gen_random_uuid(); s_b1 uuid := gen_random_uuid();
  p_a1 text; p_a2 text; p_a3 text; p_b1 text; v_p1 uuid; v_p2 uuid; v_j jsonb; v_n int; v_row public.payroll_payslips;
  v_sha text := repeat('a', 64); v_sx uuid := gen_random_uuid();
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  update public.app_settings set base_currency_code = 'IRR' where id = 1;
  update public.payroll_accounting_settings set base_salary_expense_account_id = null, net_payable_account_id = null;
  perform set_config('nil.personnel_link', 'on', true);                       -- (the guard trigger fires for every role)
  update public.personnel set profile_id = null where profile_id = v_admin;   -- (rolled back) nobody is linked to the test login yet
  perform set_config('nil.personnel_link', 'off', true);

  -- 1) fixtures --------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست۶', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست۶', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_ids := array[v_a, v_b];
  p_a1 := 'payslips/' || v_a || '/' || s_a1 || '.pdf';
  p_a2 := 'payslips/' || v_a || '/' || s_a2 || '.pdf';
  p_a3 := 'payslips/' || v_a || '/' || s_a3 || '.pdf';
  p_b1 := 'payslips/' || v_b || '/' || s_b1 || '.pdf';
  c_house := (public.create_salary_component(p_code => 'HOUSE_P6T', p_component_type => 'EARNING', p_name_fa => 'مسکن',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000, p_currency => 'IRR')).component_id;
  c_hid := (public.create_salary_component(p_code => 'HID_P6T', p_component_type => 'EARNING', p_name_fa => 'پاداش پنهان',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 500000, p_currency => 'IRR',
              p_display_on_payslip => false)).component_id;
  perform public.create_compensation_version(v_a, date '2070-01-01', 10000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house), jsonb_build_object('component_id', c_hid)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 5000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  v_period := (public.create_payroll_period(1450, 1, date '2071-03-21', date '2071-04-20')).id;

  execute 'reset role';
  insert into public.accounts (code, name, level, nature, account_type, is_active, allows_posting) values
    ('T6-EXP', 'test payroll expense', 1, 'DEBIT', 'EXPENSE', true, true),
    ('T6-NET', 'test payroll payable', 1, 'CREDIT', 'LIABILITY', true, true),
    ('T6-BANK-GL', 'test bank ledger', 1, 'DEBIT', 'ASSET', true, true);
  select id into a_exp from public.accounts where code = 'T6-EXP';
  select id into a_net from public.accounts where code = 'T6-NET';
  select id into a_gl  from public.accounts where code = 'T6-BANK-GL';
  insert into public.bank_accounts (kind, bank_name, account_title, currency_code, account_id, is_active)
    values ('BANK', 'T6 bank', 'T6 IRR account', 'IRR', a_gl, true) returning id into v_bank;
  insert into public.fiscal_years (title, start_date, end_date, status) values ('TEST-P6', date '2071-03-01', date '2072-02-28', 'OPEN')
    returning id into v_fy;
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);

  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', null)).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_batch, v_o, 'EXCLUDE', 'phase6 test fixture isolation');
  end loop;
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_calc := (public.calculate_payroll_batch(v_batch)).id;
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_calc and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_calc and personnel_id = v_b;

  -- 2) not issuable before approval; only the APPROVE tier prepares/issues ---------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  perform pg_temp.expect_err(format('select public.payroll_payslip_data(%L)', v_ra), 'PAYROLL_NOT_APPROVED');
  v_calc := pg_temp.to_approved(v_admin, v_batch);
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_calc and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_calc and personnel_id = v_b;
  perform pg_temp.chk('A net', (select net from public.payroll_results where id = v_ra), 11500000);
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  perform pg_temp.expect_err(format('select public.payroll_payslip_data(%L)', v_ra), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, s_a1, p_a1, 'x.pdf', v_sha, 'NOT_PAID'), 'NOT_AUTHORIZED');

  -- 3) payslip data: lines honour display_on_payslip, hidden items folded, totals reconcile, state truthful -----------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  v_j := public.payroll_payslip_data(v_ra);
  perform pg_temp.chk('gross', (v_j -> 'totals' ->> 'gross')::numeric, 11500000);
  perform pg_temp.chk('net',   (v_j -> 'totals' ->> 'net')::numeric,   11500000);
  perform pg_temp.chk('sum of visible earnings = gross',
    (select sum((l ->> 'amount')::numeric) from jsonb_array_elements(v_j -> 'lines') l where l ->> 'type' = 'EARNING'), 11500000);
  if exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ->> 'code' = 'HID_P6T') then raise exception 'FAIL(3): hidden component must not be listed'; end if;
  if not exists (select 1 from jsonb_array_elements(v_j -> 'lines') l where l ->> 'code' = 'OTHER_EARNINGS' and (l ->> 'amount')::numeric = 500000) then
    raise exception 'FAIL(3): hidden earnings must be folded into OTHER_EARNINGS';
  end if;
  if v_j -> 'payment' ->> 'state' <> 'NOT_PAID' or (v_j ->> 'next_revision')::int <> 1 or not (v_j ->> 'can_issue')::boolean then raise exception 'FAIL(3): initial state (%)', v_j; end if;
  if v_j::text ~* '(employer|warning|rule_key|critical)' then raise exception 'FAIL(3): payslip data must not carry employer cost / warnings / rule metadata'; end if;

  -- 4) register: path, state re-derivation, revisions only on a payment-state change --------------------------------------------------------
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, s_a1, 'payslips/wrong/path.pdf', 'x.pdf', v_sha, 'NOT_PAID'), 'PAYSLIP_PATH_INVALID');
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, s_a1, p_a1, 'x.pdf', v_sha, 'PAID'), 'PAYSLIP_STATE_CHANGED');
  v_row := public.register_payroll_payslip(v_ra, s_a1, p_a1, 'a-r1.pdf', 1000, v_sha, 'NOT_PAID');
  if v_row.revision <> 1 or v_row.payment_state_at_issue <> 'NOT_PAID' then raise exception 'FAIL(4): first revision'; end if;
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, s_a2, p_a2, 'a-r1b.pdf', v_sha, 'NOT_PAID'), 'PAYSLIP_UP_TO_DATE');
  v_j := public.payroll_payslip_data(v_ra);
  if (v_j ->> 'can_issue')::boolean or v_j ->> 'reason' <> 'UP_TO_DATE' then raise exception 'FAIL(4): unchanged state must not be re-issuable'; end if;
  v_row := public.register_payroll_payslip(v_rb, s_b1, p_b1, 'b-r1.pdf', 1000, v_sha, 'NOT_PAID');
  v_j := public.payroll_payslips_for_batch(v_batch);
  if (select count(*) from jsonb_array_elements(v_j) r where (r ->> 'can_issue')::boolean) <> 0 then raise exception 'FAIL(4): nothing should be issuable yet (%)', v_j; end if;

  execute 'reset role';
  perform pg_temp.expect_err(format('update public.payroll_payslips set revision = 9 where id = %L', s_a1), 'PAYROLL_VERSION_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('delete from public.payroll_payslips where id = %L', s_a1), 'PAYROLL_NO_DELETE');
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform pg_temp.expect_err(format('select public.reopen_payroll_batch(%L,%L)', v_batch, 'fix'), 'PAYROLL_REOPEN_BLOCKED');                -- issued payslips lock the batch
  perform pg_temp.expect_err(format('select public.change_payroll_batch_status(%L,%L,%L)', v_batch, 'CANCELLED', 'x'), 'PAYROLL_REOPEN_BLOCKED');

  -- 5) the state changes through REAL payments -> a new revision is allowed (and only then) ------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  perform public.set_payroll_accounting_settings(a_exp, a_net);
  if pg_temp.draft(v_admin, v_batch, v_bank, date '2071-04-25', v_ra, '4000000') <> 1 then raise exception 'FAIL(5): draft 1'; end if;
  execute 'reset role';
  select p.id into v_p1 from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_ra and p.status = 'DRAFT';
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.verify_payment(v_p1);
  perform public.post_payment(v_p1);
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  v_j := public.payroll_payslip_data(v_ra);
  if v_j -> 'payment' ->> 'state' <> 'PARTIALLY_PAID' or not (v_j ->> 'can_issue')::boolean then raise exception 'FAIL(5): partial payment must allow a new revision (%)', v_j; end if;
  perform pg_temp.chk('paid so far', (v_j -> 'payment' ->> 'paid')::numeric, 4000000);
  v_row := public.register_payroll_payslip(v_ra, s_a2, p_a2, 'a-r2.pdf', 1000, v_sha, 'PARTIALLY_PAID');
  if v_row.revision <> 2 then raise exception 'FAIL(5): revision 2'; end if;

  if pg_temp.draft(v_admin, v_batch, v_bank, date '2071-04-26', v_ra, '7500000') <> 1 then raise exception 'FAIL(5): draft 2'; end if;
  execute 'reset role';
  select p.id into v_p2 from public.payments p join public.payroll_payments pp on pp.payment_id = p.id where pp.result_id = v_ra and p.status = 'DRAFT';
  perform pg_temp.persona(v_admin, 'USER', null, null, 'POST');
  perform public.verify_payment(v_p2);
  perform public.post_payment(v_p2);
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  v_j := public.payroll_payslip_data(v_ra);
  if v_j -> 'payment' ->> 'state' <> 'PAID' or (v_j -> 'payment' -> 'last_date') is null or jsonb_array_length(v_j -> 'payment' -> 'numbers') <> 2 then
    raise exception 'FAIL(5): PAID payslip must carry the last payment date and both payment numbers (%)', v_j -> 'payment';
  end if;
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, s_a3, p_a3, 'a-r3.pdf', v_sha, 'PARTIALLY_PAID'), 'PAYSLIP_STATE_CHANGED');
  v_row := public.register_payroll_payslip(v_ra, s_a3, p_a3, 'a-r3.pdf', 1000, v_sha, 'PAID');
  if v_row.revision <> 3 then raise exception 'FAIL(5): revision 3'; end if;
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, v_sx, 'payslips/' || v_a || '/' || v_sx || '.pdf', 'dup.pdf', v_sha, 'PAID'), 'PAYSLIP_UP_TO_DATE');   -- same state again = no silent regeneration

  -- 6) profile link: HR ADMIN only, unique, never editable directly -----------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE', null);
  perform pg_temp.expect_err(format('select public.set_personnel_profile(%L,%L)', v_a, v_admin), 'NOT_AUTHORIZED');
  execute 'reset role';
  perform pg_temp.expect_err(format('update public.personnel set profile_id = %L where id = %L', v_admin, v_a), 'PERSONNEL_PROFILE_LOCKED');   -- direct update (even as superuser) is blocked
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  perform public.set_personnel_profile(v_a, v_admin);
  perform pg_temp.expect_err(format('select public.set_personnel_profile(%L,%L)', v_b, v_admin), 'PERSONNEL_PROFILE_LINKED');           -- one login = one personnel record

  -- 7) self-service + IDOR: the linked employee (A) sees ONLY A's payslips -----------------------------------------------------------------------
  execute 'reset role';
  insert into storage.objects (bucket_id, name) values ('nil-files', p_a1), ('nil-files', p_b1);                                         -- synthetic archive objects
  perform pg_temp.persona(v_admin, 'USER', null, null);                                                                                   -- plain employee: no payroll/HR/accounting role
  v_j := public.my_payslips();
  if not (v_j ->> 'linked')::boolean or jsonb_array_length(v_j -> 'items') <> 3 then raise exception 'FAIL(7): employee A must see exactly their 3 revisions (%)', v_j; end if;
  if (v_j -> 'items' -> 0) ? 'employer_cost' or (v_j -> 'items' -> 0) ? 'warnings' or (v_j -> 'items' -> 0) ? 'lines' then raise exception 'FAIL(7): self-service rows must be minimal'; end if;
  if (select count(*) from jsonb_array_elements(v_j -> 'items') i where (i ->> 'is_latest')::boolean) <> 1 then raise exception 'FAIL(7): exactly one latest revision'; end if;
  perform pg_temp.chk('employee sees own net', (v_j -> 'items' -> 0 ->> 'net')::numeric, 11500000);
  select count(*) into v_n from public.payroll_payslips;
  if v_n <> 3 then raise exception 'FAIL(7): employee A may read only their own 3 payslip rows, got %', v_n; end if;
  select count(*) into v_n from public.payroll_payslips where personnel_id = v_b;
  if v_n <> 0 then raise exception 'FAIL(7): IDOR — employee A read employee B''s payslip row'; end if;
  select count(*) into v_n from (select 1 from public.payroll_results union all select 1 from public.payroll_batches
                                 union all select 1 from public.personnel union all select 1 from public.payroll_payments) t;
  if v_n <> 0 then raise exception 'FAIL(7): employee read % payroll/personnel rows', v_n; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name = p_a1;
  if v_n <> 1 then raise exception 'FAIL(7): employee A must read their own archived object'; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name = p_b1;
  if v_n <> 0 then raise exception 'FAIL(7): IDOR — employee A can see employee B''s archived PDF'; end if;
  perform pg_temp.expect_err(format('select public.payroll_payslip_data(%L)', v_ra), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.payroll_payslips_for_batch(%L)', v_batch), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_ra, gen_random_uuid(), p_a1, 'x.pdf', v_sha, 'PAID'), 'NOT_AUTHORIZED');
  perform public.record_payslip_access(s_a1);
  perform pg_temp.expect_err(format('select public.record_payslip_access(%L)', s_b1), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('insert into storage.objects (bucket_id, name) values (%L,%L)', 'nil-files', 'payslips/' || v_a || '/evil.pdf'), 'row-level security');   -- no payslip uploads without the APPROVE tier

  -- payroll VIEW reads everything; HR-only / accounting-only read nothing
  perform pg_temp.persona(v_admin, 'USER', null, 'VIEW');
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name in (p_a1, p_b1);
  if v_n <> 2 then raise exception 'FAIL(7): payroll users read the payslip archive (got %)', v_n; end if;
  perform public.record_payslip_access(s_b1);
  perform pg_temp.expect_err(format('select public.register_payroll_payslip(%L,%L,%L,%L,100,%L,%L)', v_rb, gen_random_uuid(), p_b1, 'x.pdf', v_sha, 'NOT_PAID'), 'NOT_AUTHORIZED');

  -- the archive is permanent: nobody (not even payroll ADMIN or an app ADMIN) updates / deletes an archived object
  perform pg_temp.persona(v_admin, 'ADMIN', null, 'ADMIN');
  begin delete from storage.objects where bucket_id = 'nil-files' and name = p_a1; exception when others then null; end;   -- policy: 0 rows (or Supabase's own delete guard raises)
  begin update storage.objects set name = name || '.moved' where bucket_id = 'nil-files' and name = p_b1; exception when others then null; end;
  execute 'reset role';
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name in (p_a1, p_b1);
  if v_n <> 2 then raise exception 'FAIL(7): archived payslip objects must be neither deleted nor renamed (found %)', v_n; end if;

  -- 8) unlinking: the user instantly loses access; history stays ----------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  perform public.set_personnel_profile(v_a, null);
  perform pg_temp.persona(v_admin, 'USER', null, null);
  v_j := public.my_payslips();
  if (v_j ->> 'linked')::boolean or jsonb_array_length(v_j -> 'items') <> 0 then raise exception 'FAIL(8): unlinked user must see nothing (%)', v_j; end if;
  select count(*) into v_n from public.payroll_payslips; if v_n <> 0 then raise exception 'FAIL(8): unlinked user read % rows', v_n; end if;
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);                                  -- HR-only (unlinked login)
  select count(*) into v_n from public.payroll_payslips; if v_n <> 0 then raise exception 'FAIL(8): HR-only read % payslip rows', v_n; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name like 'payslips/%'; if v_n <> 0 then raise exception 'FAIL(8): HR-only read % payslip objects', v_n; end if;
  perform pg_temp.persona(v_admin, 'USER', null, null, 'ADMIN');                            -- accounting-only (unlinked login)
  select count(*) into v_n from public.payroll_payslips; if v_n <> 0 then raise exception 'FAIL(8): accounting-only read % payslip rows', v_n; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name like 'payslips/%'; if v_n <> 0 then raise exception 'FAIL(8): accounting-only read % payslip objects', v_n; end if;
  execute 'reset role';
  if (select count(*) from public.payroll_payslips where personnel_id = v_a) <> 3 then raise exception 'FAIL(8): payslip history must remain'; end if;

  -- 9) audit: no amounts anywhere in payroll logs; issue + access are logged ----------------------------------------------------------------------
  select count(*) into v_n from public.activity_logs
   where entity_type like 'payroll\_%' escape '\'
     and (coalesce(old_value::text, '') || coalesce(new_value::text, '')) ~ '\y(11500000|10000000|4000000|7500000|6000000|1000000|500000)\y';
  if v_n <> 0 then raise exception 'FAIL(9): % payroll activity_logs rows contain amounts', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type = 'payroll_payslips' and action = 'ISSUED';
  if v_n < 4 then raise exception 'FAIL(9): expected ISSUED log rows, got %', v_n; end if;
  select count(*) into v_n from public.activity_logs where entity_type = 'payroll_payslips' and action = 'ACCESSED';
  if v_n < 2 then raise exception 'FAIL(9): expected ACCESSED log rows, got %', v_n; end if;

  execute 'set constraints all immediate';
  raise notice 'PASS: payroll payslips integrity checks';
end $$;

rollback;

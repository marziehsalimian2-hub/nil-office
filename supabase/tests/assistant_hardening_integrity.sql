-- =============================================================================
-- NIL Office — Internal Assistant v1.0, Slice 1 (hardening + «فیش خودم» + «مانده حساب شرکت») integrity tests.
-- Run by hand in the Supabase SQL editor AFTER migrations 0107-0134, with at least TWO active profiles, one of them ADMIN.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (period 1452/01,
-- components 'HOUSE_ASST', personnel 'تست دستیار' — all rolled back). Real personnel are EXCLUDED from the fixture
-- batch through eligibility overrides; the real accounting mapping is blanked INSIDE the rolled-back transaction.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Covers:  (2) assistant_pending_actions immutability (0133)         (3) assistant_audit (0133)
--          (4) own-payslip functions as the employee (0134)          (5) the same functions as service_role (Telegram)
--          (6) usage accounting is function-only (0133)              (7) company balance + has_contract_access (0134)
--          (8) 'assistant' audit rows are ADMIN-only (p_logs_read)
-- Hand-computed: employee A = base 10,000,000 + house 1,000,000 = net 11,000,000 (HALF_UP, scale 0, no deductions).
-- =============================================================================
begin;

-- App persona: role + module roles, as the authenticated Postgres role (jwt role claim cleared => auth.role() is NOT service_role).
create function pg_temp.persona(p_user uuid, p_role text, p_hr text, p_payroll text, p_acc text default null) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles
     set role = p_role::app_role, hr_role = p_hr::hr_role, payroll_role = p_payroll::payroll_role, accounting_role = p_acc::accounting_role
   where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', '', true);
  execute 'set role authenticated';
end $$;

-- The Telegram path: Postgres role service_role, JWT role claim 'service_role', NO sub (auth.uid() is null).
create function pg_temp.svc() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set role service_role';
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
  v_admin uuid; v_other uuid; v_a uuid; v_b uuid; v_ids uuid[]; v_others uuid[]; v_o uuid;
  c_house uuid; v_period uuid; v_batch uuid; v_calc uuid; v_ra uuid; v_rb uuid; v_pend uuid; v_co uuid;
  s_a1 uuid := gen_random_uuid(); s_b1 uuid := gen_random_uuid();
  p_a1 text; p_b1 text; v_j jsonb; v_n int; v_c1 int; v_row public.payroll_payslips; v_sha text := repeat('a', 64);
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  select id into v_other from public.profiles where is_active and id <> v_admin
     and not exists (select 1 from public.personnel pe where pe.profile_id = public.profiles.id) limit 1;
  if v_other is null then raise exception 'need a second active profile that is not linked to a personnel record'; end if;

  update public.app_settings set base_currency_code = 'IRR' where id = 1;
  update public.payroll_accounting_settings set base_salary_expense_account_id = null, net_payable_account_id = null;
  perform set_config('nil.personnel_link', 'on', true);                       -- (the guard trigger fires for every role)
  update public.personnel set profile_id = null where profile_id = v_admin;   -- (rolled back) nobody is linked to the test login yet
  perform set_config('nil.personnel_link', 'off', true);

  -- 1) fixtures: two employees, an APPROVED batch, one registered payslip each; the test login is linked to A ---------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  v_a := (public.onboard_personnel('الف', 'تست دستیار', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_b := (public.onboard_personnel('ب', 'تست دستیار', date '2070-01-01', 'کارشناس', 'FULL_TIME')).id;
  v_ids := array[v_a, v_b];
  p_a1 := 'payslips/' || v_a || '/' || s_a1 || '.pdf';
  p_b1 := 'payslips/' || v_b || '/' || s_b1 || '.pdf';
  c_house := (public.create_salary_component(p_code => 'HOUSE_ASST', p_component_type => 'EARNING', p_name_fa => 'مسکن',
              p_calculation_method => 'FIXED', p_effective_from => date '2000-01-01', p_fixed_amount => 1000000, p_currency => 'IRR')).component_id;
  perform public.create_compensation_version(v_a, date '2070-01-01', 10000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  perform public.create_compensation_version(v_b, date '2070-01-01', 5000000, 'IRR', 'MONTHLY', null, null,
    jsonb_build_array(jsonb_build_object('component_id', c_house)));
  v_period := (public.create_payroll_period(1452, 1, date '2073-03-21', date '2073-04-20')).id;

  execute 'reset role';
  select array_agg(id) into v_others from public.personnel where id <> all(v_ids);
  perform pg_temp.persona(v_admin, 'USER', null, 'CREATE');
  v_batch := (public.create_payroll_batch(v_period, 'IRR', 0, 'HALF_UP', null)).id;
  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  foreach v_o in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.set_payroll_eligibility_override(v_batch, v_o, 'EXCLUDE', 'assistant test fixture isolation');
  end loop;
  v_calc := pg_temp.to_approved(v_admin, v_batch);
  execute 'reset role';
  select id into v_ra from public.payroll_results where calculation_id = v_calc and personnel_id = v_a;
  select id into v_rb from public.payroll_results where calculation_id = v_calc and personnel_id = v_b;
  perform pg_temp.chk('A net', (select net from public.payroll_results where id = v_ra), 11000000);

  perform pg_temp.persona(v_admin, 'USER', null, 'APPROVE');
  v_row := public.register_payroll_payslip(v_ra, s_a1, p_a1, 'a-r1.pdf', 1000, v_sha, 'NOT_PAID');
  v_row := public.register_payroll_payslip(v_rb, s_b1, p_b1, 'b-r1.pdf', 1000, v_sha, 'NOT_PAID');

  perform pg_temp.persona(v_admin, 'USER', 'ADMIN', null);
  perform public.set_personnel_profile(v_a, v_admin);                           -- the test login IS employee A

  -- 2) pending actions are tamper-proof (0133) ----------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, null);
  insert into public.assistant_pending_actions (user_id, action_name, payload, payload_hash, preview_text, expires_at)
  values (v_admin, 'CREATE_TASK_DRAFT', '{"title":"a"}'::jsonb, 'h1', 'preview', now() + interval '10 minutes') returning id into v_pend;
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set payload = %L::jsonb where id = %L', '{"title":"b"}', v_pend), 'ASSISTANT_PENDING_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set payload_hash = %L where id = %L', 'forged', v_pend), 'ASSISTANT_PENDING_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set preview_text = %L where id = %L', 'other', v_pend), 'ASSISTANT_PENDING_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set expires_at = now() + interval %L where id = %L', '1 day', v_pend), 'ASSISTANT_PENDING_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set action_name = %L where id = %L', 'CREATE_FOLLOWUP_DRAFT', v_pend), 'ASSISTANT_PENDING_IMMUTABLE');
  execute 'reset role';                                                          -- even a superuser cannot re-assign the owner
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set user_id = %L where id = %L', v_other, v_pend), 'ASSISTANT_PENDING_IMMUTABLE');
  perform pg_temp.persona(v_admin, 'USER', null, null);
  update public.assistant_pending_actions set status = 'CONFIRMED', resolved_at = now() where id = v_pend;          -- the normal transition still works
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set status = %L where id = %L', 'PENDING', v_pend), 'ASSISTANT_PENDING_FINAL');
  perform pg_temp.expect_err(format('update public.assistant_pending_actions set status = %L where id = %L', 'CANCELLED', v_pend), 'ASSISTANT_PENDING_FINAL');
  perform pg_temp.expect_err(format($f$insert into public.assistant_pending_actions (user_id, action_name, payload, payload_hash, preview_text, status, expires_at)
    values (%L, 'CREATE_TASK_DRAFT', '{}'::jsonb, 'x', 'p', 'CONFIRMED', now() + interval '1 minute')$f$, v_admin), 'ASSISTANT_PENDING_IMMUTABLE');   -- no forged pre-confirmed row

  -- 3) audit: attributed explicitly, caller-checked, event-validated ------------------------------------------------------------------------------
  perform public.assistant_audit(v_admin, 'PROPOSED', 'CREATE_TASK_DRAFT', jsonb_build_object('pending_action_id', v_pend));
  perform pg_temp.expect_err(format('select public.assistant_audit(%L,%L,%L,%L::jsonb)', v_other, 'PROPOSED', 'X', '{}'), 'NOT_AUTHORIZED');    -- a web user cannot write rows for someone else
  perform pg_temp.expect_err(format('select public.assistant_audit(%L,%L,null,%L::jsonb)', v_admin, 'bad event', '{}'), 'ASSISTANT_AUDIT_INVALID_EVENT');
  perform pg_temp.expect_err(format('select public.assistant_audit(null,%L,null,%L::jsonb)', 'PROPOSED', '{}'), 'NOT_AUTHORIZED');                -- anonymous attribution only for service_role

  -- 4) the employee's own payslip functions (authenticated, id = self) -----------------------------------------------------------------------------
  v_j := public.assistant_my_payslips(v_admin);
  if not (v_j ->> 'linked')::boolean or jsonb_array_length(v_j -> 'items') <> 1 then raise exception 'FAIL(4): employee A must see exactly their 1 payslip (%)', v_j; end if;
  perform pg_temp.chk('own net', (v_j -> 'items' -> 0 ->> 'net')::numeric, 11000000);
  if (v_j -> 'items' -> 0) ? 'employer_cost' or (v_j -> 'items' -> 0) ? 'warnings' or (v_j -> 'items' -> 0) ? 'lines' then raise exception 'FAIL(4): rows must be minimal'; end if;
  perform pg_temp.expect_err(format('select public.assistant_my_payslips(%L)', v_other), 'NOT_AUTHORIZED');                      -- cannot ask for someone else's list
  v_j := public.assistant_payslip_file(v_admin, s_a1);
  if v_j ->> 'storage_path' <> p_a1 then raise exception 'FAIL(4): own payslip path (%)', v_j; end if;
  perform pg_temp.expect_err(format('select public.assistant_payslip_file(%L,%L)', v_admin, s_b1), 'NOT_FOUND');                 -- IDOR: employee B's payslip
  perform pg_temp.expect_err(format('select public.assistant_payslip_file(%L,%L)', v_admin, gen_random_uuid()), 'NOT_FOUND');    -- same error as "does not exist"
  perform pg_temp.expect_err(format('select public.assistant_payslip_file(%L,%L)', v_other, s_a1), 'NOT_AUTHORIZED');            -- cannot impersonate another profile
  perform public.assistant_record_payslip_access(v_admin, s_a1);
  perform pg_temp.expect_err(format('select public.assistant_record_payslip_access(%L,%L)', v_admin, s_b1), 'NOT_FOUND');
  perform pg_temp.expect_err(format('select public._assistant_personnel_for(%L)', v_admin), 'permission denied');               -- the internal helper is not callable

  -- 5) the same functions on the Telegram path (service_role, auth.uid() null) -------------------------------------------------------------------------
  perform pg_temp.svc();
  v_j := public.assistant_my_payslips(v_admin);
  if jsonb_array_length(v_j -> 'items') <> 1 then raise exception 'FAIL(5): service_role must resolve the same single payslip (%)', v_j; end if;
  v_j := public.assistant_my_payslips(v_other);
  if (v_j ->> 'linked')::boolean or jsonb_array_length(v_j -> 'items') <> 0 then raise exception 'FAIL(5): an unlinked profile must see nothing (%)', v_j; end if;
  perform pg_temp.expect_err(format('select public.assistant_payslip_file(%L,%L)', v_other, s_a1), 'NOT_FOUND');                 -- someone else's payslip, even for service_role
  perform pg_temp.expect_err(format('select public.assistant_payslip_file(%L,%L)', v_admin, s_b1), 'NOT_FOUND');
  perform public.assistant_record_payslip_access(v_admin, s_a1);
  perform public.assistant_audit(v_admin, 'PAYSLIP_DELIVERED', 'GET_MY_PAYSLIP', jsonb_build_object('payslip_id', s_a1));
  perform public.assistant_audit(null, 'UNAUTHORIZED_TELEGRAM', null, '{"reason":"NOT_ALLOWED"}'::jsonb);
  select count(*) into v_c1 from public.activity_logs where entity_type = 'assistant' and action = 'UNAUTHORIZED_TELEGRAM' and created_at = now();
  perform public.assistant_audit(null, 'UNAUTHORIZED_TELEGRAM', null, '{"reason":"NOT_ALLOWED"}'::jsonb);
  select count(*) into v_n from public.activity_logs where entity_type = 'assistant' and action = 'UNAUTHORIZED_TELEGRAM' and created_at = now();
  if v_n <> v_c1 then raise exception 'FAIL(5): unauthorized-sender audit must be rate-limited (% -> %)', v_c1, v_n; end if;
  if (select count(*) from public.activity_logs where entity_type = 'payroll_payslips' and action = 'ACCESSED' and user_id = v_admin and new_value ->> 'channel' = 'TELEGRAM') < 1 then
    raise exception 'FAIL(5): the Telegram delivery must be logged against the profile';
  end if;

  -- 6) usage accounting: function-only access --------------------------------------------------------------------------------------------------------
  perform public.assistant_record_usage(v_admin, 'TELEGRAM', 'LLM', 100, 50, 10);
  perform public.assistant_record_usage(v_admin, 'TELEGRAM', 'STT', 30, 0, 10);
  v_j := public.assistant_usage_today(v_admin);
  if (v_j ->> 'llm_tokens')::int < 150 or (v_j ->> 'stt_seconds')::int < 30 or (v_j ->> 'stt_last_minute')::int < 1 then raise exception 'FAIL(6): usage today (%)', v_j; end if;
  perform pg_temp.persona(v_admin, 'USER', null, null);
  perform public.assistant_record_usage(v_admin, 'WEB', 'LLM', 10, 5, 1);
  perform pg_temp.expect_err(format('select public.assistant_record_usage(%L,%L,%L,1,1,1)', v_other, 'WEB', 'LLM'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.assistant_usage_today(%L)', v_other), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select * from public.assistant_usage', 'permission denied');                                     -- no table access for authenticated

  -- 7) company balance + has_contract_access (service_role branch) ---------------------------------------------------------------------------------------
  perform pg_temp.svc();
  if not public.has_contract_access() then raise exception 'FAIL(7): has_contract_access() must be true for service_role'; end if;
  execute 'reset role';
  update public.profiles set role = 'ADMIN' where id = v_admin;
  select id into v_co from public.companies limit 1;
  if v_co is not null then
    perform pg_temp.svc();
    v_j := public.assistant_company_balance(v_admin, v_co);
    if v_j -> 'company' ->> 'id' <> v_co::text or jsonb_typeof(v_j -> 'currencies') <> 'array' then raise exception 'FAIL(7): company balance shape (%)', v_j; end if;
    if exists (select 1 from jsonb_array_elements(v_j -> 'currencies') c where jsonb_typeof(c -> 'received') <> 'string' or jsonb_typeof(c -> 'paid') <> 'string' or jsonb_typeof(c -> 'outstanding_invoices') <> 'string') then
      raise exception 'FAIL(7): amounts must be exact TEXT (%)', v_j;
    end if;
    perform pg_temp.expect_err(format('select public.assistant_company_balance(%L,%L)', v_admin, gen_random_uuid()), 'NOT_FOUND');
    execute 'reset role';
    update public.profiles set role = 'USER', accounting_role = null, invoice_role = null, contract_role = null where id = v_admin;
    perform pg_temp.svc();
    perform pg_temp.expect_err(format('select public.assistant_company_balance(%L,%L)', v_admin, v_co), 'NOT_AUTHORIZED');          -- no financial role -> refused even for service_role
    perform pg_temp.persona(v_admin, 'ADMIN', null, null);
    perform pg_temp.expect_err(format('select public.assistant_company_balance(%L,%L)', v_other, v_co), 'NOT_AUTHORIZED');          -- a web user cannot pass another profile id
  end if;

  -- 8) 'assistant' audit rows are ADMIN-only -----------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN', null, null);
  select count(*) into v_n from public.activity_logs where entity_type = 'assistant' and created_at = now();
  if v_n < 1 then raise exception 'FAIL(8): an ADMIN must read the assistant audit rows'; end if;
  perform pg_temp.persona(v_admin, 'USER', null, null);
  select count(*) into v_n from public.activity_logs where entity_type = 'assistant' and created_at = now();
  if v_n <> 0 then raise exception 'FAIL(8): a plain user read % assistant audit rows', v_n; end if;
  perform pg_temp.persona(v_admin, 'USER', null, 'ADMIN');
  select count(*) into v_n from public.activity_logs where entity_type = 'assistant' and created_at = now();
  if v_n <> 0 then raise exception 'FAIL(8): payroll ADMIN (not app ADMIN) read % assistant audit rows', v_n; end if;

  -- audit rows carry no amounts / payload (codes + ids only)
  execute 'reset role';
  select count(*) into v_n from public.activity_logs
   where entity_type = 'assistant' and created_at = now() and (coalesce(new_value::text, '')) ~ '\y(11000000|10000000|1000000|5000000)\y';
  if v_n <> 0 then raise exception 'FAIL(8): % assistant audit rows contain amounts', v_n; end if;

  execute 'set constraints all immediate';
  raise notice 'PASS: assistant hardening + payslip + company-balance integrity checks';
end $$;

rollback;

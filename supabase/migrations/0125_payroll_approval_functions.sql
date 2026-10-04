-- =====================================================================
-- NIL Office — 0125_payroll_approval_functions.sql
-- HR & Payroll — Phase 4 — approval, lock, reopen, account mapping, accounting draft.
-- RESTATED (each had exactly ONE prior definition, verified by grep before writing):
--   save_payroll_work_data (0120)   + APPROVED lock
--   _payroll_batch_stale   (0121)   + RULES_CHANGED, APPROVED => no stale reasons
--   change_payroll_batch_status (0121) + ADMIN tier, USE_APPROVE/USE_REOPEN, cancel-after-approval rules
-- All new RPCs are SECURITY DEFINER, tier check FIRST. No write_log payload contains an amount.
-- The journal draft is NEVER posted here (post_journal_entry stays Accounting's own flow).
-- =====================================================================

create or replace function public._payroll_live_journal(p_journal uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.journal_entries j where j.id = p_journal and j.status <> 'REVERSED');
$$;

create or replace function public._payroll_account_ok(p_account uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts a where a.id = p_account and a.is_active and a.allows_posting);
$$;

create or replace function public.save_payroll_work_data(
  p_period_id uuid, p_personnel_id uuid,
  p_work_days numeric default null, p_work_hours numeric default null, p_overtime_hours numeric default null,
  p_absence_days numeric default null, p_absence_hours numeric default null,
  p_paid_leave_days numeric default null, p_unpaid_leave_days numeric default null,
  p_mission_days numeric default null, p_mission_hours numeric default null,
  p_notes text default null, p_inputs jsonb default '[]'::jsonb, p_source text default 'MANUAL'
) returns public.payroll_work_data
language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods; v_row public.payroll_work_data;
  v_in jsonb; v_cid uuid; v_amt numeric; v_cur text; v_seen uuid[] := '{}';
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_source is null or p_source not in ('MANUAL','ADJUSTMENT') then   -- other sources are reserved (no integration yet)
    raise exception 'PAYROLL_WORK_DATA_INVALID' using errcode = '22000';
  end if;
  if jsonb_typeof(coalesce(p_inputs, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_period.status <> 'OPEN' then raise exception 'PAYROLL_PERIOD_CLOSED' using errcode = '22000'; end if;
  perform 1 from public.personnel where id = p_personnel_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- Phase 4 lock: no silent edits once a batch containing this person is APPROVED (correction = reopen workflow).
  if exists (select 1 from public.payroll_results r
               join public.payroll_batches b on b.id = r.batch_id and b.approved_calculation_id = r.calculation_id
              where b.period_id = p_period_id and b.status = 'APPROVED' and r.personnel_id = p_personnel_id) then
    raise exception 'PAYROLL_APPROVED_LOCKED' using errcode = '22000';
  end if;

  perform pg_advisory_xact_lock(hashtext('payroll_wd:' || p_period_id::text || ':' || p_personnel_id::text));

  begin
    insert into public.payroll_work_data (
      period_id, personnel_id, work_days, work_hours, overtime_hours, absence_days, absence_hours,
      paid_leave_days, unpaid_leave_days, mission_days, mission_hours, notes, source, created_by, updated_by)
    values (
      p_period_id, p_personnel_id, p_work_days, p_work_hours, p_overtime_hours, p_absence_days, p_absence_hours,
      p_paid_leave_days, p_unpaid_leave_days, p_mission_days, p_mission_hours, nullif(btrim(p_notes), ''), p_source,
      auth.uid(), auth.uid())
    on conflict (period_id, personnel_id) do update set
      work_days = excluded.work_days, work_hours = excluded.work_hours, overtime_hours = excluded.overtime_hours,
      absence_days = excluded.absence_days, absence_hours = excluded.absence_hours,
      paid_leave_days = excluded.paid_leave_days, unpaid_leave_days = excluded.unpaid_leave_days,
      mission_days = excluded.mission_days, mission_hours = excluded.mission_hours,
      notes = excluded.notes, source = excluded.source,
      revision = public.payroll_work_data.revision + 1, updated_by = auth.uid(), updated_at = now()
    returning * into v_row;
  exception
    when check_violation or numeric_value_out_of_range then
      raise exception 'PAYROLL_WORK_DATA_INVALID' using errcode = '22000';
  end;

  for v_in in select * from jsonb_array_elements(coalesce(p_inputs, '[]'::jsonb)) loop
    begin
      v_cid := nullif(v_in ->> 'component_id', '')::uuid;
      v_amt := nullif(v_in ->> 'amount', '')::numeric;
      v_cur := nullif(v_in ->> 'currency', '');
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_VALUE' using errcode = '22000';
    end;
    if v_cid is null or v_amt is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
    if v_amt < 0 then raise exception 'INVALID_AMOUNT' using errcode = '22000'; end if;
    if v_cur is null or v_cur not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
      raise exception 'INVALID_CURRENCY' using errcode = '22000';
    end if;
    if v_cid = any(v_seen)
       or not exists (select 1 from public.salary_component_versions v where v.component_id = v_cid and v.calculation_method = 'MANUAL_INPUT') then
      raise exception 'PAYROLL_INPUT_COMPONENT_INVALID' using errcode = '22000';
    end if;
    v_seen := v_seen || v_cid;
    insert into public.payroll_work_inputs (work_data_id, component_id, amount, currency, note)
    values (v_row.id, v_cid, v_amt, v_cur, nullif(btrim(v_in ->> 'note'), ''))
    on conflict (work_data_id, component_id) do update
      set amount = excluded.amount, currency = excluded.currency, note = excluded.note, updated_at = now();
  end loop;
  delete from public.payroll_work_inputs where work_data_id = v_row.id and component_id <> all(v_seen);

  return v_row;
end; $$;


create or replace function public._payroll_batch_stale(p_batch_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_b public.payroll_batches; v_c public.payroll_calculations; v_p public.payroll_periods; v_out text[] := '{}';
begin
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found or v_b.current_calculation_id is null or v_b.status in ('CANCELLED','APPROVED') then return v_out; end if;   -- APPROVED = locked snapshot
  select * into v_c from public.payroll_calculations where id = v_b.current_calculation_id;
  select * into v_p from public.payroll_periods where id = v_b.period_id;

  if v_c.jurisdiction is distinct from v_b.jurisdiction or v_c.rounding_scale <> v_b.rounding_scale or v_c.rounding_mode <> v_b.rounding_mode then
    v_out := array_append(v_out, 'SETTINGS_CHANGED');
  end if;
  if exists (select 1 from public.payroll_results r
              where r.calculation_id = v_c.id
                and coalesce(r.work_data_revision, 0) <> coalesce(
                      (select wd.revision from public.payroll_work_data wd where wd.period_id = v_b.period_id and wd.personnel_id = r.personnel_id), 0)) then
    v_out := array_append(v_out, 'WORK_DATA_CHANGED');
  end if;
  if exists (select 1 from public.payroll_results r
              where r.calculation_id = v_c.id
                and r.compensation_profile_id is distinct from (public._payroll_profile_on(r.personnel_id, v_p.period_end)).id) then
    v_out := array_append(v_out, 'COMPENSATION_CHANGED');
  end if;
  if exists (
    with e as (select x.personnel_id from public._payroll_eligibility(v_b.period_id, p_batch_id) x where x.included),
         r as (select rr.personnel_id from public.payroll_results rr where rr.calculation_id = v_c.id)
    select 1 from ((select personnel_id from e except select personnel_id from r)
                   union all
                   (select personnel_id from r except select personnel_id from e)) d
  ) then
    v_out := array_append(v_out, 'ELIGIBILITY_CHANGED');
  end if;
  -- Phase 4: a legal rule approved/retired AFTER calculation changes what the engine would resolve => recalculate.
  if exists (
    select 1 from (
      select distinct l.rule_key, l.rule_entry_id
        from public.payroll_result_lines l join public.payroll_results r on r.id = l.result_id
       where r.calculation_id = v_c.id and l.rule_key is not null and l.rule_entry_id is not null) x
     where not exists (select 1 from public._payroll_rule_for_period(v_c.jurisdiction, x.rule_key, v_c.period_start, v_c.period_end) q
                        where q.o_status = 'OK' and q.o_entry_id = x.rule_entry_id)
  ) or exists (
    select 1 from public.payroll_calc_warnings w
     where w.calculation_id = v_c.id and w.rule_key is not null
       and w.code in ('RULE_MISSING','RULE_CHANGES_IN_PERIOD','RULE_AMBIGUOUS')
       and (select q.o_status from public._payroll_rule_for_period(v_c.jurisdiction, w.rule_key, v_c.period_start, v_c.period_end) q) is distinct from w.code
  ) then
    v_out := array_append(v_out, 'RULES_CHANGED');
  end if;
  return v_out;
end; $$;


-- ---------------------------------------------------------------------
-- Status changes (restated): the two dedicated transitions have their own RPCs.
-- ---------------------------------------------------------------------
create or replace function public.change_payroll_batch_status(p_batch_id uuid, p_new_status text, p_note text default null)
returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_batches; v_tier text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if p_new_status = 'CALCULATED' and v_row.status = 'DRAFT' then raise exception 'PAYROLL_USE_CALCULATE' using errcode = '22000'; end if;
  if p_new_status = 'APPROVED' then raise exception 'PAYROLL_USE_APPROVE' using errcode = '22000'; end if;
  if v_row.status = 'APPROVED' and p_new_status = 'UNDER_REVIEW' then raise exception 'PAYROLL_USE_REOPEN' using errcode = '22000'; end if;

  select required_tier into v_tier from public.payroll_batch_transitions where from_status = v_row.status and to_status = p_new_status;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if v_tier = 'ADMIN' then
    if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif v_tier = 'APPROVE' then
    if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;
  if (p_new_status = 'CANCELLED' or (v_row.status = 'UNDER_REVIEW' and p_new_status = 'CALCULATED')) and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = '22000';
  end if;
  if v_row.status = 'CALCULATED' and p_new_status = 'UNDER_REVIEW' then
    if v_row.current_calculation_id is null then raise exception 'PAYROLL_NOT_CALCULATED' using errcode = '22000'; end if;
    if cardinality(public._payroll_batch_stale(p_batch_id)) > 0 then raise exception 'PAYROLL_BATCH_STALE' using errcode = '22000'; end if;
  end if;
  if v_row.status = 'APPROVED' and p_new_status = 'CANCELLED' and public._payroll_live_journal(v_row.accounting_journal_entry_id) then
    raise exception 'PAYROLL_REOPEN_BLOCKED' using errcode = '22000';
  end if;

  update public.payroll_batches set
    status       = p_new_status,
    status_note  = v_note,
    submitted_by = case p_new_status when 'UNDER_REVIEW' then auth.uid() when 'CALCULATED' then null else submitted_by end,
    submitted_at = case p_new_status when 'UNDER_REVIEW' then now()      when 'CALCULATED' then null else submitted_at end,
    reviewed_by  = case when p_new_status = 'CALCULATED' then null else reviewed_by end,
    reviewed_at  = case when p_new_status = 'CALCULATED' then null else reviewed_at end,
    cancelled_by = case when p_new_status = 'CANCELLED' then auth.uid() else cancelled_by end,
    cancelled_at = case when p_new_status = 'CANCELLED' then now()      else cancelled_at end,
    updated_at   = now()
   where id = p_batch_id returning * into v_row;
  return v_row;   -- tg_payroll_audit already logs the status change (whitelisted columns, no note)
end; $$;

-- ---------------------------------------------------------------------
-- Final approval (APPROVE tier). Locks the financial result.
-- Segregation of duties is RECORDED, not enforced (product decision): flags go into the log, the UI shows a warning.
-- ---------------------------------------------------------------------
create or replace function public.approve_payroll_batch(p_batch_id uuid, p_note text default null)
returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare
  v_row public.payroll_batches; v_n integer; v_crit integer; v_incomplete integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if v_row.status <> 'UNDER_REVIEW' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if v_row.reviewed_at is null then raise exception 'PAYROLL_NOT_REVIEWED' using errcode = '22000'; end if;
  if cardinality(public._payroll_batch_stale(p_batch_id)) > 0 then raise exception 'PAYROLL_BATCH_STALE' using errcode = '22000'; end if;

  select count(*), count(*) filter (where not r.is_complete) into v_n, v_incomplete
    from public.payroll_results r where r.calculation_id = v_row.current_calculation_id;
  if v_n = 0 then raise exception 'PAYROLL_NOTHING_TO_APPROVE' using errcode = '22000'; end if;
  select count(*) into v_crit from public.payroll_calc_warnings w
   where w.calculation_id = v_row.current_calculation_id and w.severity = 'CRITICAL';
  if v_crit > 0 or v_incomplete > 0 then raise exception 'PAYROLL_HAS_CRITICAL' using errcode = '22000'; end if;

  update public.payroll_batches set
    status = 'APPROVED', approved_by = auth.uid(), approved_at = now(),
    approved_calculation_id = current_calculation_id, status_note = v_note, updated_at = now()
   where id = p_batch_id returning * into v_row;

  perform public.write_log('payroll_batches', p_batch_id, 'APPROVED', null, jsonb_build_object(
    'calculation_version', v_row.calculation_version, 'personnel_count', v_n,
    'approver_is_submitter', v_row.approved_by is not distinct from v_row.submitted_by,
    'approver_is_reviewer',  v_row.approved_by is not distinct from v_row.reviewed_by));
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- Controlled reopen (payroll ADMIN + reason). Blocked while a live (DRAFT/POSTED) journal is linked.
-- ---------------------------------------------------------------------
create or replace function public.reopen_payroll_batch(p_batch_id uuid, p_reason text)
returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_batches; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if v_row.status <> 'APPROVED' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if public._payroll_live_journal(v_row.accounting_journal_entry_id) then raise exception 'PAYROLL_REOPEN_BLOCKED' using errcode = '22000'; end if;

  update public.payroll_batches set
    status = 'UNDER_REVIEW', approved_by = null, approved_at = null, approved_calculation_id = null,
    reviewed_by = null, reviewed_at = null, status_note = v_reason, updated_at = now()
   where id = p_batch_id returning * into v_row;
  perform public.write_log('payroll_batches', p_batch_id, 'REOPENED', null,
    jsonb_build_object('calculation_version', v_row.calculation_version, 'reason', v_reason));
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- Account mapping (payroll ADMIN). Accounts must exist, be active and be postable (type is NOT enforced:
-- a loan-installment deduction legitimately credits an ASSET account).
-- ---------------------------------------------------------------------
create or replace function public.set_payroll_accounting_settings(p_base_salary_expense uuid, p_net_payable uuid)
returns public.payroll_accounting_settings
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_accounting_settings;
begin
  if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_base_salary_expense is null or p_net_payable is null
     or not public._payroll_account_ok(p_base_salary_expense) or not public._payroll_account_ok(p_net_payable) then
    raise exception 'PAYROLL_ACCOUNT_INVALID' using errcode = '22000';
  end if;
  insert into public.payroll_accounting_settings (singleton, base_salary_expense_account_id, net_payable_account_id, updated_by)
  values (true, p_base_salary_expense, p_net_payable, auth.uid())
  on conflict (singleton) do update
    set base_salary_expense_account_id = excluded.base_salary_expense_account_id,
        net_payable_account_id = excluded.net_payable_account_id, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.set_payroll_component_accounts(p_component_id uuid, p_expense uuid, p_liability uuid)
returns public.payroll_component_accounts
language plpgsql security definer set search_path = public as $$
declare v_type salary_component_type; v_exp uuid; v_liab uuid; v_row public.payroll_component_accounts;
begin
  if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select component_type into v_type from public.salary_components where id = p_component_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_type = 'INFORMATIONAL' then raise exception 'PAYROLL_ACCOUNT_INVALID' using errcode = '22000'; end if;
  v_exp  := case when v_type in ('EARNING','EMPLOYER_COST') then p_expense end;
  v_liab := case when v_type in ('DEDUCTION','EMPLOYER_COST') then p_liability end;
  if (v_type in ('EARNING','EMPLOYER_COST') and (v_exp is null or not public._payroll_account_ok(v_exp)))
     or (v_type in ('DEDUCTION','EMPLOYER_COST') and (v_liab is null or not public._payroll_account_ok(v_liab))) then
    raise exception 'PAYROLL_ACCOUNT_INVALID' using errcode = '22000';
  end if;
  insert into public.payroll_component_accounts (component_id, component_type, expense_account_id, liability_account_id, updated_by)
  values (p_component_id, v_type, v_exp, v_liab, auth.uid())
  on conflict (component_id) do update
    set expense_account_id = excluded.expense_account_id, liability_account_id = excluded.liability_account_id, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;

-- Postable accounts for the mapping pickers (the accounts table itself needs accounting access).
create or replace function public.payroll_accounting_accounts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name,
                                                      'account_type', a.account_type, 'nature', a.nature) order by a.code)
                     from public.accounts a where a.is_active and a.allows_posting), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------
-- Journal lines of a batch (internal). Aggregated per component — NEVER per employee (journal lines are readable by
-- every accounting user; individual salaries must not leak). account_id is NULL when a mapping is missing.
-- Basis: the APPROVED calculation (or the current one while not yet approved). INFORMATIONAL and zero totals are skipped.
-- ---------------------------------------------------------------------
create or replace function public._payroll_journal_lines(p_batch_id uuid)
returns table (ord integer, kind text, component_code text, label text, account_id uuid, debit numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  with b as (
    select id, coalesce(approved_calculation_id, current_calculation_id) as calc_id from public.payroll_batches where id = p_batch_id
  ), s as (
    select * from public.payroll_accounting_settings limit 1
  ), agg as (
    select l.component_id, l.component_code, max(l.component_name_fa) as name_fa, l.component_type, sum(l.amount) as amt
      from public.payroll_result_lines l
      join public.payroll_results r on r.id = l.result_id
      join b on b.calc_id = r.calculation_id
     where l.status = 'COMPUTED' and l.component_type <> 'INFORMATIONAL'
     group by l.component_id, l.component_code, l.component_type
    having sum(l.amount) > 0
  ), m as (
    select a.*, pca.expense_account_id as m_exp, pca.liability_account_id as m_liab
      from agg a left join public.payroll_component_accounts pca on pca.component_id = a.component_id
  )
  select 1, 'EARNING', m.component_code, m.name_fa,
         case when m.component_id is null then (select s.base_salary_expense_account_id from s) else m.m_exp end,
         m.amt, 0::numeric
    from m where m.component_type = 'EARNING'
  union all
  select 2, 'EMPLOYER_COST', m.component_code, m.name_fa, m.m_exp, m.amt, 0::numeric from m where m.component_type = 'EMPLOYER_COST'
  union all
  select 3, 'DEDUCTION', m.component_code, m.name_fa, m.m_liab, 0::numeric, m.amt from m where m.component_type = 'DEDUCTION'
  union all
  select 4, 'EMPLOYER_COST', m.component_code, m.name_fa, m.m_liab, 0::numeric, m.amt from m where m.component_type = 'EMPLOYER_COST'
  union all
  select 5, 'NET_PAYABLE', 'NET_PAYABLE', 'حقوق و دستمزد پرداختنی', (select s.net_payable_account_id from s), 0::numeric, t.net_total
    from (select coalesce(sum(r.net), 0) as net_total from public.payroll_results r join b on b.calc_id = r.calculation_id) t
   where t.net_total > 0;
$$;

-- Readiness for the batch page: base-currency check, missing mappings, linked journal. No amounts.
create or replace function public.payroll_accounting_readiness(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_base text; v_s public.payroll_accounting_settings; v_missing jsonb; v_j jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select base_currency_code into v_base from public.app_settings where id = 1;
  select * into v_s from public.payroll_accounting_settings limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('code', x.component_code, 'name', x.label) order by x.component_code), '[]'::jsonb)
    into v_missing
    from (select distinct l.component_code, l.label from public._payroll_journal_lines(p_batch_id) l
           where l.account_id is null and l.kind in ('EARNING','EMPLOYER_COST','DEDUCTION') and l.component_code <> 'BASE_SALARY') x;

  select jsonb_build_object('id', j.id, 'status', j.status, 'document_number', j.document_number)
    into v_j from public.journal_entries j where j.id = v_b.accounting_journal_entry_id;

  return jsonb_build_object(
    'base_currency', v_base,
    'currency_ok', v_b.currency = v_base,
    'settings_ok', v_s.base_salary_expense_account_id is not null and v_s.net_payable_account_id is not null,
    'missing_components', v_missing,
    'journal', v_j,
    'can_draft', v_b.status = 'APPROVED' and not public._payroll_live_journal(v_b.accounting_journal_entry_id));
end; $$;

-- ---------------------------------------------------------------------
-- Create the DRAFT journal entry (idempotent per batch). Needs BOTH payroll-approve and accounting-create (like 0063).
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_accounting_draft(p_batch_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_period public.payroll_periods; v_base text; v_s public.payroll_accounting_settings;
  v_fy uuid; v_entry uuid; v_debit numeric; v_credit numeric; v_missing integer; v_bad integer; v_lines integer;
begin
  if not public.can_approve_payroll() or not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_b from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status <> 'APPROVED' then raise exception 'PAYROLL_NOT_APPROVED' using errcode = '22000'; end if;
  if public._payroll_live_journal(v_b.accounting_journal_entry_id) then
    raise exception 'PAYROLL_ACCOUNTING_DRAFT_EXISTS' using errcode = '22000';
  end if;

  select base_currency_code into v_base from public.app_settings where id = 1;
  if v_b.currency is distinct from v_base then raise exception 'PAYROLL_CURRENCY_NOT_BASE' using errcode = '22000'; end if;

  select * into v_s from public.payroll_accounting_settings limit 1;
  if v_s.base_salary_expense_account_id is null or v_s.net_payable_account_id is null then
    raise exception 'PAYROLL_ACCOUNT_MAPPING_MISSING' using errcode = '22000';
  end if;
  select count(*), count(*) filter (where l.account_id is null),
         count(*) filter (where l.account_id is not null and not public._payroll_account_ok(l.account_id)),
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    into v_lines, v_missing, v_bad, v_debit, v_credit
    from public._payroll_journal_lines(p_batch_id) l;
  if v_missing > 0 then raise exception 'PAYROLL_ACCOUNT_MAPPING_MISSING' using errcode = '22000'; end if;
  if v_bad > 0 then raise exception 'PAYROLL_ACCOUNT_INVALID' using errcode = '22000'; end if;
  if v_lines < 2 or v_debit <= 0 or v_debit <> v_credit then raise exception 'PAYROLL_LEDGER_MISMATCH' using errcode = '22000'; end if;

  select * into v_period from public.payroll_periods where id = v_b.period_id;
  select id into v_fy from public.fiscal_years
   where status = 'OPEN' and start_date <= v_period.period_end and end_date >= v_period.period_end limit 1;
  if v_fy is null then raise exception 'FISCAL_YEAR_CLOSED' using errcode = '22000'; end if;

  insert into public.journal_entries (fiscal_year_id, document_date, description, reference, status, created_by)
  values (v_fy, v_period.period_end, 'حقوق و دستمزد — دستهٔ ' || v_b.batch_number, v_b.batch_number, 'DRAFT', auth.uid())
  returning id into v_entry;

  insert into public.journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_no)
  select v_entry, l.account_id, l.label, l.debit, l.credit, row_number() over (order by l.ord, l.component_code)
    from public._payroll_journal_lines(p_batch_id) l;

  update public.payroll_batches
     set accounting_journal_entry_id = v_entry, accounting_drafted_by = auth.uid(), accounting_drafted_at = now(), updated_at = now()
   where id = p_batch_id;

  perform public.write_log('payroll_batches', p_batch_id, 'ACCOUNTING_DRAFT_CREATED', null, jsonb_build_object('journal_entry_id', v_entry, 'line_count', v_lines));
  perform public.write_log('journal_entries', v_entry, 'CREATED_FROM_PAYROLL_BATCH', null, jsonb_build_object('payroll_batch_id', p_batch_id));
  return v_entry;
end; $$;

-- =====================================================================
-- ROLLBACK: drop function if exists public.create_payroll_accounting_draft(uuid), public.payroll_accounting_readiness(uuid),
--   public._payroll_journal_lines(uuid), public.payroll_accounting_accounts(), public.set_payroll_component_accounts(uuid,uuid,uuid),
--   public.set_payroll_accounting_settings(uuid,uuid), public.reopen_payroll_batch(uuid,text), public.approve_payroll_batch(uuid,text),
--   public._payroll_account_ok(uuid), public._payroll_live_journal(uuid);
-- then re-run 0120 (save_payroll_work_data), 0121 (_payroll_batch_stale, change_payroll_batch_status).
-- =====================================================================

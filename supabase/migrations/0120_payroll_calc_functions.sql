-- =====================================================================
-- NIL Office — 0120_payroll_calc_functions.sql
-- HR & Payroll — Phase 3 — internal helpers + write RPCs for period / work data /
-- batch / eligibility overrides. SECURITY DEFINER, tier check FIRST, row/advisory
-- locks. write_log payloads never contain amounts. Internal helpers (_payroll_*)
-- are revoked from everyone in 0123 (definer callers still reach them).
-- =====================================================================

create or replace function public._payroll_round(p_amount numeric, p_scale integer, p_mode text)
returns numeric language sql immutable as $$
  select case p_mode
    when 'HALF_UP' then round(p_amount, p_scale)      -- amounts are always >= 0, so half-up == half-away-from-zero
    when 'DOWN'    then trunc(p_amount, p_scale)
    when 'UP'      then case when p_amount = trunc(p_amount, p_scale) then p_amount
                             else trunc(p_amount, p_scale) + 1 / power(10::numeric, p_scale) end
  end;
$$;

create or replace function public._payroll_add_warning(
  p_calc uuid, p_batch uuid, p_personnel uuid, p_severity text, p_code text,
  p_component text default null, p_rule_key text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.payroll_calc_warnings (calculation_id, batch_id, personnel_id, severity, code, component_code, rule_key)
  values (p_calc, p_batch, p_personnel, p_severity, p_code, p_component, p_rule_key);
$$;

-- Compensation version in force on a date (half-open [effective_from, effective_to)). No row => all-null composite.
create or replace function public._payroll_profile_on(p_personnel_id uuid, p_on date)
returns public.compensation_profiles language sql stable security definer set search_path = public as $$
  select c.* from public.compensation_profiles c
   where c.personnel_id = p_personnel_id and c.effective_from <= p_on
     and (c.effective_to is null or p_on < c.effective_to)
   order by c.version_number desc limit 1;
$$;

-- APPROVED rule entries in force on a date for one jurisdiction + key.
create or replace function public._payroll_resolve_rule(p_jurisdiction text, p_rule_key text, p_on date)
returns table (rule_set_id uuid, entry_id uuid, value_numeric numeric, unit text)
language sql stable security definer set search_path = public as $$
  select s.id, e.id, e.value_numeric, e.unit
    from public.legal_rule_sets s
    join public.legal_rule_entries e on e.rule_set_id = s.id
   where s.status = 'APPROVED' and s.jurisdiction = p_jurisdiction and e.rule_key = p_rule_key
     and s.effective_from <= p_on and (s.effective_to is null or p_on < s.effective_to);
$$;

-- The rule must resolve to the SAME single entry at period_start and period_end.
create or replace function public._payroll_rule_for_period(p_jurisdiction text, p_rule_key text, p_start date, p_end date)
returns table (o_status text, o_rule_set_id uuid, o_entry_id uuid, o_value numeric, o_unit text)
language plpgsql stable security definer set search_path = public as $$
declare n_end integer; n_start integer; v_e record; v_s record;
begin
  if p_jurisdiction is null or length(btrim(p_jurisdiction)) = 0 then
    return query select 'RULE_MISSING'::text, null::uuid, null::uuid, null::numeric, null::text; return;
  end if;
  select count(*) into n_end   from public._payroll_resolve_rule(p_jurisdiction, p_rule_key, p_end);
  select count(*) into n_start from public._payroll_resolve_rule(p_jurisdiction, p_rule_key, p_start);
  if n_end = 0 and n_start = 0 then
    return query select 'RULE_MISSING'::text, null::uuid, null::uuid, null::numeric, null::text; return;
  elsif n_end > 1 or n_start > 1 then
    return query select 'RULE_AMBIGUOUS'::text, null::uuid, null::uuid, null::numeric, null::text; return;
  elsif n_end = 0 or n_start = 0 then
    return query select 'RULE_CHANGES_IN_PERIOD'::text, null::uuid, null::uuid, null::numeric, null::text; return;
  end if;
  select * into v_e from public._payroll_resolve_rule(p_jurisdiction, p_rule_key, p_end);
  select * into v_s from public._payroll_resolve_rule(p_jurisdiction, p_rule_key, p_start);
  if v_e.entry_id <> v_s.entry_id then
    return query select 'RULE_CHANGES_IN_PERIOD'::text, null::uuid, null::uuid, null::numeric, null::text; return;
  end if;
  return query select 'OK'::text, v_e.rule_set_id, v_e.entry_id, v_e.value_numeric, v_e.unit;
end; $$;

-- Eligibility. Hard rule: an employment record overlaps [period_start, period_end] (half-open record end).
-- Personnel STATUS is deliberately ignored (an ARCHIVED person is still payable for a past period).
-- Overrides: EXCLUDE / INCLUDE (AUTO = cleared). A batch (when given) restricts to its currency;
-- people with no profile stay in every batch (flagged later). INCLUDE can never force another currency in.
create or replace function public._payroll_eligibility(p_period_id uuid, p_batch_id uuid default null)
returns table (
  personnel_id uuid, in_period boolean, override_decision text, included boolean,
  profile_id uuid, currency text, partial_period boolean, comp_changed boolean
)
language sql stable security definer set search_path = public as $$
  select x.pid, x.in_period, x.decision,
         (case x.decision when 'EXCLUDE' then false when 'INCLUDE' then true else x.in_period end)
           and (b.id is null or x.prof_id is null or x.prof_cur = b.currency),
         x.prof_id, x.prof_cur, x.partial, x.changed
    from (
      select p.id as pid,
             exists (select 1 from public.employment_records er
                      where er.personnel_id = p.id and er.start_date <= per.period_end
                        and (er.end_date is null or er.end_date > per.period_start)) as in_period,
             case when o.decision in ('INCLUDE','EXCLUDE') then o.decision end as decision,
             pe.id as prof_id, pe.currency as prof_cur,
             (p.hire_date > per.period_start
               or (p.termination_date is not null and p.termination_date <= per.period_end)) as partial,
             (ps.id is not null and pe.id is not null and ps.id <> pe.id) as changed
        from public.personnel p
        cross join public.payroll_periods per
        left join public.payroll_eligibility_overrides o on o.personnel_id = p.id and o.batch_id = p_batch_id
        left join lateral public._payroll_profile_on(p.id, per.period_end)   pe on true
        left join lateral public._payroll_profile_on(p.id, per.period_start) ps on true
       where per.id = p_period_id
    ) x
    left join public.payroll_batches b on b.id = p_batch_id
   where x.in_period or x.decision is not null;
$$;

-- ---------------------------------------------------------------------
-- Period
-- ---------------------------------------------------------------------
-- The app computes the boundaries (lib/payroll/period.ts); the DB only sanity-checks:
-- month length, start within +/-2 days of Mar-21 + cumulative month offset, no overlap.
create or replace function public.create_payroll_period(
  p_jalali_year integer, p_jalali_month integer, p_period_start date, p_period_end date
) returns public.payroll_periods
language plpgsql security definer set search_path = public as $$
declare
  v_len integer; v_offset integer; v_expected date; v_fy public.fiscal_years; v_row public.payroll_periods;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_jalali_year is null or p_jalali_month is null or p_period_start is null or p_period_end is null
     or p_jalali_year not between 1300 and 1500 or p_jalali_month not between 1 and 12 then
    raise exception 'PAYROLL_PERIOD_INVALID' using errcode = '22000';
  end if;
  v_len := p_period_end - p_period_start + 1;
  if not (case when p_jalali_month <= 6 then v_len = 31
               when p_jalali_month <= 11 then v_len = 30
               else v_len in (29, 30) end) then
    raise exception 'PAYROLL_PERIOD_INVALID' using errcode = '22000';
  end if;
  v_offset := case when p_jalali_month <= 7 then (p_jalali_month - 1) * 31 else 186 + (p_jalali_month - 7) * 30 end;
  v_expected := make_date(p_jalali_year + 621, 3, 21) + v_offset;
  if abs(p_period_start - v_expected) > 2 then
    raise exception 'PAYROLL_PERIOD_INVALID' using errcode = '22000';
  end if;

  perform pg_advisory_xact_lock(hashtext('payroll_period_create'));
  if exists (select 1 from public.payroll_periods where jalali_year = p_jalali_year and jalali_month = p_jalali_month) then
    raise exception 'PAYROLL_PERIOD_DUPLICATE' using errcode = '22000';
  end if;
  if exists (select 1 from public.payroll_periods
              where daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')) then
    raise exception 'PAYROLL_PERIOD_OVERLAP' using errcode = '22000';
  end if;

  select * into v_fy from public.fiscal_years
   where start_date <= p_period_start and end_date >= p_period_end order by start_date limit 1;
  if found and v_fy.status = 'CLOSED' then raise exception 'FISCAL_YEAR_CLOSED' using errcode = '22000'; end if;

  insert into public.payroll_periods (jalali_year, jalali_month, period_start, period_end, fiscal_year_id, created_by)
  values (p_jalali_year, p_jalali_month, p_period_start, p_period_end, v_fy.id, auth.uid())
  returning * into v_row;
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- Work data (+ money inputs). Edits after a calculation never change results; they only make the batch stale.
-- p_inputs: [{component_id, amount (STRING), currency, note}] — full replacement set for this person+period.
-- ---------------------------------------------------------------------
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

-- Bulk wrapper: one transaction for the whole grid. p_rows: [{personnel_id, work_days, ..., notes, inputs:[...]}] (numbers as strings).
create or replace function public.save_payroll_work_data_rows(p_period_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_n integer := 0;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      perform public.save_payroll_work_data(
        p_period_id, (v ->> 'personnel_id')::uuid,
        nullif(v ->> 'work_days', '')::numeric,        nullif(v ->> 'work_hours', '')::numeric,
        nullif(v ->> 'overtime_hours', '')::numeric,   nullif(v ->> 'absence_days', '')::numeric,
        nullif(v ->> 'absence_hours', '')::numeric,    nullif(v ->> 'paid_leave_days', '')::numeric,
        nullif(v ->> 'unpaid_leave_days', '')::numeric, nullif(v ->> 'mission_days', '')::numeric,
        nullif(v ->> 'mission_hours', '')::numeric,
        nullif(v ->> 'notes', ''), coalesce(v -> 'inputs', '[]'::jsonb), 'MANUAL');
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_VALUE' using errcode = '22000';
    end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

-- ---------------------------------------------------------------------
-- Batch
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_batch(
  p_period_id uuid, p_currency text, p_rounding_scale integer, p_rounding_mode text,
  p_jurisdiction text default null, p_notes text default null, p_payroll_type text default 'REGULAR'
) returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods; v_row public.payroll_batches; v_seq integer;
  v_jur text := nullif(btrim(coalesce(p_jurisdiction, '')), '');
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_currency is null or p_currency not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
  end if;
  if p_rounding_scale is null or p_rounding_scale not between 0 and 4
     or p_rounding_mode is null or p_rounding_mode not in ('HALF_UP','DOWN','UP') then
    raise exception 'PAYROLL_ROUNDING_INVALID' using errcode = '22000';
  end if;
  if p_payroll_type is distinct from 'REGULAR' then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;

  perform pg_advisory_xact_lock(hashtext('payroll_period:' || coalesce(p_period_id::text, '')));
  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_period.status <> 'OPEN' then raise exception 'PAYROLL_PERIOD_CLOSED' using errcode = '22000'; end if;

  if v_jur is not null and not exists (select 1 from public.legal_rule_sets where jurisdiction = v_jur) then
    raise exception 'PAYROLL_JURISDICTION_UNKNOWN' using errcode = '22000';
  end if;
  -- checked BEFORE allocate_sequence so a rejected duplicate never burns a number
  if exists (select 1 from public.payroll_batches
              where period_id = p_period_id and payroll_type = p_payroll_type and currency = p_currency and status <> 'CANCELLED') then
    raise exception 'PAYROLL_BATCH_DUPLICATE' using errcode = '22000';
  end if;

  v_seq := public.allocate_sequence('PAYROLL_BATCH', v_period.jalali_year);
  insert into public.payroll_batches (
    batch_number, year, sequence_number, period_id, payroll_type, currency, jurisdiction,
    rounding_scale, rounding_mode, notes, created_by)
  values (
    public.format_display_number('PAYROLL_BATCH', v_period.jalali_year, v_seq), v_period.jalali_year, v_seq,
    p_period_id, p_payroll_type, p_currency, v_jur, p_rounding_scale, p_rounding_mode,
    nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_row;
  return v_row;
end; $$;

-- Settings editable in DRAFT / CALCULATED only; a change makes the batch stale until recalculated.
create or replace function public.update_payroll_batch_settings(
  p_batch_id uuid, p_jurisdiction text, p_rounding_scale integer, p_rounding_mode text
) returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_batches; v_jur text := nullif(btrim(coalesce(p_jurisdiction, '')), '');
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if v_row.status not in ('DRAFT','CALCULATED') then raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '22000'; end if;
  if p_rounding_scale is null or p_rounding_scale not between 0 and 4
     or p_rounding_mode is null or p_rounding_mode not in ('HALF_UP','DOWN','UP') then
    raise exception 'PAYROLL_ROUNDING_INVALID' using errcode = '22000';
  end if;
  if v_jur is not null and not exists (select 1 from public.legal_rule_sets where jurisdiction = v_jur) then
    raise exception 'PAYROLL_JURISDICTION_UNKNOWN' using errcode = '22000';
  end if;
  update public.payroll_batches
     set jurisdiction = v_jur, rounding_scale = p_rounding_scale, rounding_mode = p_rounding_mode, updated_at = now()
   where id = p_batch_id returning * into v_row;
  return v_row;
end; $$;

-- Eligibility override (APPROVE tier + reason). decision AUTO clears it.
create or replace function public.set_payroll_eligibility_override(
  p_batch_id uuid, p_personnel_id uuid, p_decision text, p_reason text default null
) returns public.payroll_eligibility_overrides
language plpgsql security definer set search_path = public as $$
declare
  v_batch public.payroll_batches; v_period public.payroll_periods; v_row public.payroll_eligibility_overrides;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_prof public.compensation_profiles;
begin
  if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('INCLUDE','EXCLUDE','AUTO') then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;
  if p_decision <> 'AUTO' and v_reason is null then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;

  select * into v_batch from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_batch.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if v_batch.status not in ('DRAFT','CALCULATED') then raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '22000'; end if;
  perform 1 from public.personnel where id = p_personnel_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_period from public.payroll_periods where id = v_batch.period_id;
  if p_decision = 'INCLUDE' then
    v_prof := public._payroll_profile_on(p_personnel_id, v_period.period_end);
    if v_prof.id is not null and v_prof.currency <> v_batch.currency then
      raise exception 'PAYROLL_OVERRIDE_INVALID' using errcode = '22000';
    end if;
  end if;

  insert into public.payroll_eligibility_overrides (batch_id, personnel_id, decision, reason, decided_by)
  values (p_batch_id, p_personnel_id, p_decision, v_reason, auth.uid())
  on conflict (batch_id, personnel_id) do update
    set decision = excluded.decision, reason = excluded.reason, decided_by = auth.uid(), decided_at = now()
  returning * into v_row;
  return v_row;
end; $$;

-- =====================================================================
-- ROLLBACK: drop function if exists public.set_payroll_eligibility_override(uuid,uuid,text,text),
--   public.update_payroll_batch_settings(uuid,text,integer,text), public.create_payroll_batch(uuid,text,integer,text,text,text,text),
--   public.save_payroll_work_data_rows(uuid,jsonb),
--   public.save_payroll_work_data(uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb,text),
--   public.create_payroll_period(integer,integer,date,date), public._payroll_eligibility(uuid,uuid),
--   public._payroll_rule_for_period(text,text,date,date), public._payroll_resolve_rule(text,text,date),
--   public._payroll_profile_on(uuid,date), public._payroll_add_warning(uuid,uuid,uuid,text,text,text,text),
--   public._payroll_round(numeric,integer,text);
-- =====================================================================

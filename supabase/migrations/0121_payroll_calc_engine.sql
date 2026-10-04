-- =====================================================================
-- NIL Office — 0121_payroll_calc_engine.sql
-- HR & Payroll — Phase 3 — DETERMINISTIC calculation engine (SQL, numeric, ONE transaction).
-- engine_version PAYROLL_ENGINE_1. Methods: FIXED, PERCENTAGE (fixed % or APPROVED-rule %),
-- MANUAL_INPUT. QUANTITY_X_RATE / FORMULA are NEVER evaluated (CRITICAL, no amount).
-- No overtime / absence / leave / proration formulas — those hours are stored and shown only.
-- Rounding: every line amount is rounded ONCE (batch scale + mode); totals are plain sums of rounded lines.
-- =====================================================================

create or replace function public._payroll_calc_personnel(
  p_calc_id uuid, p_personnel_id uuid, p_profile_id uuid, p_override text, p_partial boolean, p_comp_changed boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_calc public.payroll_calculations; v_batch public.payroll_batches; v_person public.personnel;
  v_prof public.compensation_profiles; v_wd public.payroll_work_data; v_has_wd boolean;
  v_result uuid := gen_random_uuid(); v_order integer := 0; v_stop boolean := false; v_unsupported boolean := false;
  v_pass integer; v_l record; v_rule record; v_is_gross boolean; v_blocked boolean := false;
  v_base numeric := 0; v_gross numeric := 0; v_ded numeric := 0; v_emp numeric := 0;
  v_status text; v_raw numeric; v_amount numeric; v_src text; v_basis text; v_base_used numeric;
  v_rate numeric; v_rate_src text; v_rule_set uuid; v_rule_entry uuid;
  v_in_amt numeric; v_in_cur text; v_in_found boolean;
  v_complete boolean; v_crit integer; v_warn integer; v_maxpass integer := 2;
begin
  select * into v_calc   from public.payroll_calculations where id = p_calc_id;
  select * into v_batch  from public.payroll_batches where id = v_calc.batch_id;
  select * into v_person from public.personnel where id = p_personnel_id;
  select * into v_wd from public.payroll_work_data where period_id = v_batch.period_id and personnel_id = p_personnel_id;
  v_has_wd := found;

  -- ---- person-level notes (codes only) ----
  if p_partial then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'PARTIAL_PERIOD'); end if;
  if p_comp_changed then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'COMPENSATION_CHANGED_IN_PERIOD'); end if;
  if p_override = 'INCLUDE' then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'ELIGIBILITY_OVERRIDDEN'); end if;
  if v_person.employment_status = 'SUSPENDED' then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'PERSONNEL_SUSPENDED'); end if;
  if not v_has_wd then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'MISSING_WORK_DATA');
  elsif coalesce(v_wd.overtime_hours, 0) > 0 or coalesce(v_wd.absence_days, 0) > 0 or coalesce(v_wd.absence_hours, 0) > 0
        or coalesce(v_wd.unpaid_leave_days, 0) > 0 then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'INFO', 'HOURS_NOT_APPLIED');
  end if;
  -- existence only; no bank value is ever read into any output
  if not exists (select 1 from public.personnel_payment_destinations d where d.personnel_id = p_personnel_id and d.is_active) then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'MISSING_BANK_DESTINATION');
  end if;

  if p_profile_id is null then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'MISSING_COMPENSATION');
    v_stop := true;
  else
    select * into v_prof from public.compensation_profiles where id = p_profile_id;
    if v_prof.currency is distinct from v_calc.currency and v_prof.currency is not null then
      perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'CURRENCY_MISMATCH');
      v_stop := true;
    elsif exists (select 1 from public.payroll_results r join public.payroll_batches b2 on b2.current_calculation_id = r.calculation_id
                   where r.personnel_id = p_personnel_id and r.currency is not null and b2.id <> v_batch.id
                     and b2.period_id = v_batch.period_id and b2.payroll_type = v_batch.payroll_type and b2.status <> 'CANCELLED') then
      perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'DUPLICATE_PAYROLL');
      v_stop := true;
    end if;
  end if;

  if not v_stop then
    v_unsupported := (v_prof.payment_frequency <> 'MONTHLY');
    if v_unsupported then
      perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'UNSUPPORTED_PAYMENT_FREQUENCY');
      v_order := 1;
      insert into public.payroll_result_lines (result_id, line_order, component_code, component_name_fa, component_type, method, status)
      values (v_result, 1, 'BASE_SALARY', 'حقوق پایه', 'EARNING', 'PROFILE_BASE', 'NOT_COMPUTED');
    else
      v_base := public._payroll_round(v_prof.base_salary, v_calc.rounding_scale, v_calc.rounding_mode);
      v_order := 1;
      insert into public.payroll_result_lines (result_id, line_order, component_code, component_name_fa, component_type, method, status, amount, amount_source)
      values (v_result, 1, 'BASE_SALARY', 'حقوق پایه', 'EARNING', 'PROFILE_BASE', 'COMPUTED', v_base, 'PROFILE');
    end if;

    -- pass 1 = every line that is NOT GROSS_EARNINGS-based; pass 2 = GROSS_EARNINGS-based lines (needs gross).
    v_maxpass := case when v_unsupported then 0 else 2 end;
    for v_pass in 1 .. v_maxpass loop
      if v_pass = 2 then
        select coalesce(sum(l.amount), 0) into v_gross from public.payroll_result_lines l
         where l.result_id = v_result and l.component_type = 'EARNING' and l.status = 'COMPUTED';
        v_blocked :=
          exists (select 1 from public.payroll_result_lines l where l.result_id = v_result and l.component_type = 'EARNING' and l.status = 'NOT_COMPUTED')
          or exists (select 1 from public.compensation_lines cl2 join public.salary_component_versions ver2 on ver2.id = cl2.component_version_id
                      where cl2.compensation_profile_id = v_prof.id and ver2.component_type = 'EARNING'
                        and ver2.calculation_method = 'PERCENTAGE' and ver2.percentage_basis = 'GROSS_EARNINGS');
      end if;

      for v_l in
        select cl.component_id, cl.component_version_id as version_id, cl.amount_override, cl.percentage_override,
               sc.code as c_code, sc.is_active as c_active, ver.component_type as c_type, ver.name_fa,
               ver.calculation_method::text as method, ver.fixed_amount, ver.currency as v_currency,
               ver.percentage, ver.percentage_basis as basis, ver.rule_key, ver.taxable, ver.insurable
          from public.compensation_lines cl
          join public.salary_components sc on sc.id = cl.component_id
          join public.salary_component_versions ver on ver.id = cl.component_version_id
         where cl.compensation_profile_id = v_prof.id
         order by ver.display_order, sc.code
      loop
        v_is_gross := (v_l.method = 'PERCENTAGE' and v_l.basis = 'GROSS_EARNINGS');
        if (v_pass = 1 and v_is_gross) or (v_pass = 2 and not v_is_gross) then continue; end if;

        v_status := 'NOT_COMPUTED'; v_raw := null; v_amount := null; v_src := null; v_basis := null; v_base_used := null;
        v_rate := null; v_rate_src := null; v_rule_set := null; v_rule_entry := null;
        if not v_l.c_active then
          perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'COMPONENT_INACTIVE', v_l.c_code);
        end if;

        if v_l.method = 'FIXED' then
          if v_l.amount_override is not null then
            v_raw := v_l.amount_override; v_src := 'COMPENSATION_OVERRIDE';
          elsif v_l.fixed_amount is null then
            perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'COMPONENT_AMOUNT_MISSING', v_l.c_code);
          elsif v_l.v_currency is distinct from v_calc.currency then
            perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'CURRENCY_MISMATCH', v_l.c_code);
          else
            v_raw := v_l.fixed_amount; v_src := 'COMPONENT_DEFAULT';
          end if;

        elsif v_l.method = 'MANUAL_INPUT' then
          select i.amount, i.currency into v_in_amt, v_in_cur from public.payroll_work_inputs i
           where i.work_data_id = v_wd.id and i.component_id = v_l.component_id;
          v_in_found := found;
          if not v_in_found then
            perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'MANUAL_INPUT_MISSING', v_l.c_code);
          elsif v_in_cur is distinct from v_calc.currency then
            perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'CURRENCY_MISMATCH', v_l.c_code);
          else
            v_raw := v_in_amt; v_src := 'MANUAL_INPUT';
          end if;

        elsif v_l.method = 'PERCENTAGE' then
          v_basis := v_l.basis;
          if v_l.rule_key is not null then
            select * into v_rule from public._payroll_rule_for_period(v_calc.jurisdiction, v_l.rule_key, v_calc.period_start, v_calc.period_end);
            if v_rule.o_status <> 'OK' then
              perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', v_rule.o_status, v_l.c_code, v_l.rule_key);
            elsif v_rule.o_value is null or upper(btrim(coalesce(v_rule.o_unit, ''))) <> 'PERCENT'
                  or v_rule.o_value < 0 or v_rule.o_value > 100 then
              perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'RULE_VALUE_INVALID', v_l.c_code, v_l.rule_key);
            else
              v_rate := v_rule.o_value; v_rate_src := 'RULE'; v_src := 'RULE';
              v_rule_set := v_rule.o_rule_set_id; v_rule_entry := v_rule.o_entry_id;
            end if;
          else
            v_rate := coalesce(v_l.percentage_override, v_l.percentage);
            v_rate_src := case when v_l.percentage_override is not null then 'COMPENSATION_OVERRIDE' else 'COMPONENT' end;
            v_src := case when v_l.percentage_override is not null then 'COMPENSATION_OVERRIDE' else 'COMPONENT_DEFAULT' end;   -- amount_source CHECK (0119) has no 'COMPONENT'
            if v_rate is null then
              perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'COMPONENT_AMOUNT_MISSING', v_l.c_code);
            end if;
          end if;

          if v_rate is not null then
            if v_basis = 'BASE_SALARY' then
              v_base_used := v_base;
            elsif v_l.c_type = 'EARNING' then      -- an earning that depends on gross includes itself
              perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'CIRCULAR_BASIS', v_l.c_code);
            elsif v_blocked then
              perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'GROSS_BASIS_INCOMPLETE', v_l.c_code);
            else
              v_base_used := v_gross;
            end if;
            if v_base_used is not null then v_raw := v_base_used * v_rate / 100; end if;
          end if;

        else   -- QUANTITY_X_RATE / FORMULA: defined, never evaluated, never guessed
          perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'UNSUPPORTED_METHOD', v_l.c_code);
        end if;

        if v_raw is not null then
          v_amount := public._payroll_round(v_raw, v_calc.rounding_scale, v_calc.rounding_mode);
          v_status := 'COMPUTED';
        end if;

        v_order := v_order + 1;
        insert into public.payroll_result_lines (
          result_id, line_order, component_id, component_version_id, component_code, component_name_fa, component_type,
          method, status, amount, amount_source, basis, base_amount, rate, rate_source, rule_key, rule_set_id, rule_entry_id,
          taxable, insurable)
        values (
          v_result, v_order, v_l.component_id, v_l.version_id, v_l.c_code, v_l.name_fa, v_l.c_type,
          v_l.method, v_status, v_amount, v_src, v_basis, v_base_used, v_rate, v_rate_src, v_l.rule_key, v_rule_set, v_rule_entry,
          v_l.taxable, v_l.insurable);
      end loop;
    end loop;
  end if;

  -- ---- totals: sums of rounded lines; EMPLOYER_COST never reduces net; INFORMATIONAL excluded ----
  select coalesce(sum(l.amount) filter (where l.component_type = 'EARNING'), 0),
         coalesce(sum(l.amount) filter (where l.component_type = 'DEDUCTION'), 0),
         coalesce(sum(l.amount) filter (where l.component_type = 'EMPLOYER_COST'), 0)
    into v_gross, v_ded, v_emp
    from public.payroll_result_lines l where l.result_id = v_result and l.status = 'COMPUTED';
  v_complete := (not v_stop) and not exists (select 1 from public.payroll_result_lines l where l.result_id = v_result and l.status = 'NOT_COMPUTED');
  if v_complete and v_gross - v_ded < 0 then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'NEGATIVE_NET');
  end if;

  select count(*) filter (where w.severity = 'CRITICAL'), count(*) filter (where w.severity = 'WARNING')
    into v_crit, v_warn
    from public.payroll_calc_warnings w where w.calculation_id = p_calc_id and w.personnel_id = p_personnel_id;

  insert into public.payroll_results (
    id, calculation_id, batch_id, personnel_id, personnel_number, personnel_name,
    compensation_profile_id, compensation_version_number, work_data_id, work_data_revision, currency,
    gross, total_deductions, employer_cost, net, is_complete, critical_count, warning_count, inputs)
  values (
    v_result, p_calc_id, v_calc.batch_id, p_personnel_id, v_person.personnel_number,
    v_person.first_name || ' ' || v_person.last_name,
    v_prof.id, v_prof.version_number, v_wd.id, v_wd.revision, v_prof.currency,
    v_gross, v_ded, v_emp, v_gross - v_ded, v_complete, v_crit, v_warn,
    jsonb_build_object(
      'payment_frequency', v_prof.payment_frequency, 'partial_period', p_partial, 'override', p_override,
      'work_data', case when v_has_wd then jsonb_build_object(
        'revision', v_wd.revision, 'work_days', v_wd.work_days, 'work_hours', v_wd.work_hours,
        'overtime_hours', v_wd.overtime_hours, 'absence_days', v_wd.absence_days, 'absence_hours', v_wd.absence_hours,
        'paid_leave_days', v_wd.paid_leave_days, 'unpaid_leave_days', v_wd.unpaid_leave_days,
        'mission_days', v_wd.mission_days, 'mission_hours', v_wd.mission_hours) end));
end; $$;

create or replace function public.calculate_payroll_batch(p_batch_id uuid)
returns public.payroll_calculations
language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid; v_batch public.payroll_batches; v_period public.payroll_periods; v_calc public.payroll_calculations;
  v_e record; v_n integer := 0; v_crit integer; v_warn integer;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select period_id into v_pid from public.payroll_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- same advisory key as create_payroll_batch: serialises calculate / create per period
  perform pg_advisory_xact_lock(hashtext('payroll_period:' || v_pid::text));
  select * into v_batch from public.payroll_batches where id = p_batch_id for update;
  select * into v_period from public.payroll_periods where id = v_pid;

  if v_batch.status not in ('DRAFT','CALCULATED') then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if v_period.status <> 'OPEN' then raise exception 'PAYROLL_PERIOD_CLOSED' using errcode = '22000'; end if;

  insert into public.payroll_calculations (
    batch_id, calculation_version, engine_version, currency, jurisdiction, rounding_scale, rounding_mode,
    period_start, period_end, calculated_by)
  values (
    p_batch_id, v_batch.calculation_version + 1, 'PAYROLL_ENGINE_1', v_batch.currency, v_batch.jurisdiction,
    v_batch.rounding_scale, v_batch.rounding_mode, v_period.period_start, v_period.period_end, auth.uid())
  returning * into v_calc;

  for v_e in
    select e.personnel_id, e.profile_id, e.override_decision, e.partial_period, e.comp_changed
      from public._payroll_eligibility(v_pid, p_batch_id) e
      join public.personnel p on p.id = e.personnel_id
     where e.included
     order by p.personnel_number
  loop
    perform public._payroll_calc_personnel(v_calc.id, v_e.personnel_id, v_e.profile_id, v_e.override_decision, v_e.partial_period, v_e.comp_changed);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    perform public._payroll_add_warning(v_calc.id, p_batch_id, null, 'CRITICAL', 'NO_ELIGIBLE_PERSONNEL');
  end if;

  update public.payroll_batches
     set status = 'CALCULATED', calculation_version = v_calc.calculation_version, current_calculation_id = v_calc.id,
         calculated_by = auth.uid(), calculated_at = now(),
         reviewed_by = null, reviewed_at = null, updated_at = now()
   where id = p_batch_id;

  select count(*) filter (where severity = 'CRITICAL'), count(*) filter (where severity = 'WARNING')
    into v_crit, v_warn from public.payroll_calc_warnings where calculation_id = v_calc.id;
  perform public.write_log('payroll_batches', p_batch_id, 'CALCULATED', null,
    jsonb_build_object('calculation_version', v_calc.calculation_version, 'personnel_count', v_n,
                       'critical_count', v_crit, 'warning_count', v_warn));
  return v_calc;
end; $$;

-- Reasons the current calculation no longer matches the live inputs ('{}' = fresh).
create or replace function public._payroll_batch_stale(p_batch_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_b public.payroll_batches; v_c public.payroll_calculations; v_p public.payroll_periods; v_out text[] := '{}';
begin
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found or v_b.current_calculation_id is null or v_b.status = 'CANCELLED' then return v_out; end if;
  select * into v_c from public.payroll_calculations where id = v_b.current_calculation_id;
  select * into v_p from public.payroll_periods where id = v_b.period_id;

  if v_c.jurisdiction is distinct from v_b.jurisdiction or v_c.rounding_scale <> v_b.rounding_scale or v_c.rounding_mode <> v_b.rounding_mode then
    v_out := v_out || 'SETTINGS_CHANGED';
  end if;
  if exists (select 1 from public.payroll_results r
              where r.calculation_id = v_c.id
                and coalesce(r.work_data_revision, 0) <> coalesce(
                      (select wd.revision from public.payroll_work_data wd where wd.period_id = v_b.period_id and wd.personnel_id = r.personnel_id), 0)) then
    v_out := v_out || 'WORK_DATA_CHANGED';
  end if;
  if exists (select 1 from public.payroll_results r
              where r.calculation_id = v_c.id
                and r.compensation_profile_id is distinct from (public._payroll_profile_on(r.personnel_id, v_p.period_end)).id) then
    v_out := v_out || 'COMPENSATION_CHANGED';
  end if;
  if exists (
    with e as (select x.personnel_id from public._payroll_eligibility(v_b.period_id, p_batch_id) x where x.included),
         r as (select rr.personnel_id from public.payroll_results rr where rr.calculation_id = v_c.id)
    select 1 from ((select personnel_id from e except select personnel_id from r)
                   union all
                   (select personnel_id from r except select personnel_id from e)) d
  ) then
    v_out := v_out || 'ELIGIBILITY_CHANGED';
  end if;
  return v_out;
end; $$;

-- Server-controlled transitions (lookup table + tier). Calculation itself is calculate_payroll_batch.
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

  select required_tier into v_tier from public.payroll_batch_transitions where from_status = v_row.status and to_status = p_new_status;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if v_tier = 'APPROVE' then
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
  return v_row;   -- tg_payroll_audit already logs the status change (whitelisted column, no note)
end; $$;

-- "Reviewed" is a STAMP (not a status): APPROVE tier, UNDER_REVIEW only, refused while stale. Creator may review (recorded, not blocked).
create or replace function public.mark_payroll_batch_reviewed(p_batch_id uuid)
returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_batches;
begin
  if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if v_row.status <> 'UNDER_REVIEW' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if v_row.reviewed_at is not null then raise exception 'PAYROLL_ALREADY_REVIEWED' using errcode = '22000'; end if;
  if cardinality(public._payroll_batch_stale(p_batch_id)) > 0 then raise exception 'PAYROLL_BATCH_STALE' using errcode = '22000'; end if;
  update public.payroll_batches set reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_batch_id returning * into v_row;
  perform public.write_log('payroll_batches', p_batch_id, 'REVIEWED', null, jsonb_build_object('calculation_version', v_row.calculation_version));
  return v_row;
end; $$;

-- =====================================================================
-- ROLLBACK: drop function if exists public.mark_payroll_batch_reviewed(uuid), public.change_payroll_batch_status(uuid,text,text),
--   public._payroll_batch_stale(uuid), public.calculate_payroll_batch(uuid),
--   public._payroll_calc_personnel(uuid,uuid,uuid,text,boolean,boolean);
-- =====================================================================

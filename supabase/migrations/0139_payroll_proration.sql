-- =====================================================================
-- NIL Office — 0139_payroll_proration.sql
-- HR & Payroll — Phase 9: PAYROLL_ENGINE_3 — calendar-day proration of a partial month (hired / left mid-period).
--
--   ratio = employed_days / period_days     (period_days = the real Jalali month, 29-31; employed_days = days of the period
--                                            covered by ANY employment record, half-open [start_date, end_date))
--   used only when 0 < employed_days < period_days; a full-month person gets exactly the pre-Phase-9 numbers.
--   BASE_SALARY line                     = round(base_salary x employed_days / period_days)
--   FIXED component ticked «prorate»     = round(amount x employed_days / period_days)   (default amount OR per-person override)
--   PERCENTAGE lines                     follow automatically (their basis is the prorated base / the gross)
--   MANUAL_INPUT, QUANTITY_X_RATE        never prorated; overtime / absence use the FULL, unprorated base salary (or hourly rate) as the wage.
--   One division, one final rounding per line. Every prorated line stores details.proration = {employed_days, period_days};
--   payroll_results.inputs.proration records the person-level days. A part-month flag with NO employment days in the period
--   prorates nothing and raises the WARNING PRORATION_NOT_APPLIED (a salary is never silently zeroed).
--   NO legal value anywhere: which allowances should be prorated is the company's decision (the per-component tick).
--
-- Restated from the CURRENT bodies (grep of ALL migrations): _payroll_calc_personnel + calculate_payroll_batch (0138 only),
--   payroll_payslip_data (0138 only; payslip lines now carry the proration trace), _payroll_insert_component_version /
--   create_salary_component / create_salary_component_version (0137 only; one more optional parameter, old signatures dropped).
--   payroll_result_detail already returns every line's `details`, so it is unchanged.
-- service_role is NOT granted (payroll is web-only). Approved calculations (ENGINE_1/2) are immutable and untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) the per-component tick (FIXED only; frozen with the version by the immutability trigger like every other field)
-- ---------------------------------------------------------------------
alter table public.salary_component_versions
  add column if not exists prorate_on_partial_period boolean not null default false;

alter table public.salary_component_versions drop constraint if exists ck_scv_prorate;
alter table public.salary_component_versions add constraint ck_scv_prorate
  check (not prorate_on_partial_period or calculation_method = 'FIXED');

-- ---------------------------------------------------------------------
-- 2) write paths (old 22-parameter signatures dropped so PostgREST never sees two overloads)
-- ---------------------------------------------------------------------
drop function if exists public._payroll_insert_component_version(uuid,integer,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text);
drop function if exists public.create_salary_component(text,text,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text);
drop function if exists public.create_salary_component_version(uuid,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text);

create or replace function public._payroll_insert_component_version(
  p_component_id uuid, p_version integer, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text, p_fixed_amount numeric, p_currency text, p_percentage numeric, p_percentage_basis text,
  p_rule_key text, p_taxable boolean, p_insurable boolean, p_display_on_payslip boolean,
  p_display_order integer, p_change_note text,
  p_quantity_source text default null, p_rate_mode text default null, p_unit_divisor numeric default null,
  p_divisor_rule_key text default null, p_rate_multiplier numeric default null, p_multiplier_rule_key text default null,
  p_prorate_on_partial_period boolean default false
) returns public.salary_component_versions
language plpgsql security definer set search_path = public as $$
declare v_type salary_component_type; v_row public.salary_component_versions;
begin
  if p_effective_from is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  if p_name_fa is null or length(btrim(p_name_fa)) = 0 then raise exception 'COMPONENT_NAME_REQUIRED' using errcode = '22000'; end if;
  if p_currency is not null and p_currency not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
  end if;
  if coalesce(p_prorate_on_partial_period, false) and p_calculation_method is distinct from 'FIXED' then
    raise exception 'COMPONENT_INVALID_COMBINATION' using errcode = '22000';   -- proration is only offered on a FIXED amount
  end if;
  if p_calculation_method = 'QUANTITY_X_RATE' and (p_quantity_source is null or p_rate_mode is null) then
    raise exception 'COMPONENT_INVALID_COMBINATION' using errcode = '22000';   -- a new QUANTITY_X_RATE definition must be complete
  end if;
  select component_type into v_type from public.salary_components where id = p_component_id;
  begin
    insert into public.salary_component_versions (
      component_id, component_type, version_number, name_fa, name_en, calculation_method,
      fixed_amount, currency, percentage, percentage_basis, rule_key, taxable, insurable,
      display_on_payslip, display_order, effective_from, change_note, created_by,
      quantity_source, rate_mode, unit_divisor, divisor_rule_key, rate_multiplier, multiplier_rule_key, prorate_on_partial_period)
    values (
      p_component_id, v_type, p_version, btrim(p_name_fa), nullif(btrim(p_name_en), ''),
      p_calculation_method::salary_calculation_method, p_fixed_amount, p_currency, p_percentage,
      p_percentage_basis, nullif(btrim(p_rule_key), ''), coalesce(p_taxable, false), coalesce(p_insurable, false),
      coalesce(p_display_on_payslip, true), coalesce(p_display_order, 0), p_effective_from, p_change_note, auth.uid(),
      nullif(btrim(p_quantity_source), ''), nullif(btrim(p_rate_mode), ''), p_unit_divisor,
      nullif(btrim(p_divisor_rule_key), ''), p_rate_multiplier, nullif(btrim(p_multiplier_rule_key), ''),
      coalesce(p_prorate_on_partial_period, false))
    returning * into v_row;
  exception
    when check_violation then raise exception 'COMPONENT_INVALID_COMBINATION' using errcode = '22000';
    when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_VALUE' using errcode = '22000';
  end;
  return v_row;
end; $$;

create or replace function public.create_salary_component(
  p_code text, p_component_type text, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text default null, p_fixed_amount numeric default null, p_currency text default null,
  p_percentage numeric default null, p_percentage_basis text default null, p_rule_key text default null,
  p_taxable boolean default false, p_insurable boolean default false, p_display_on_payslip boolean default true,
  p_display_order integer default 0, p_change_note text default null,
  p_quantity_source text default null, p_rate_mode text default null, p_unit_divisor numeric default null,
  p_divisor_rule_key text default null, p_rate_multiplier numeric default null, p_multiplier_rule_key text default null,
  p_prorate_on_partial_period boolean default false
) returns public.salary_component_versions
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_id uuid;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,39}$' then raise exception 'COMPONENT_CODE_INVALID' using errcode = '22000'; end if;
  if exists (select 1 from public.salary_components where code = v_code) then
    raise exception 'COMPONENT_CODE_DUPLICATE' using errcode = '22000';
  end if;
  begin
    insert into public.salary_components (code, component_type, created_by)
    values (v_code, p_component_type::salary_component_type, auth.uid()) returning id into v_id;
  exception when invalid_text_representation then raise exception 'INVALID_VALUE' using errcode = '22000';
  end;
  return public._payroll_insert_component_version(v_id, 1, p_name_fa, p_calculation_method, p_effective_from,
    p_name_en, p_fixed_amount, p_currency, p_percentage, p_percentage_basis, p_rule_key,
    p_taxable, p_insurable, p_display_on_payslip, p_display_order, p_change_note,
    p_quantity_source, p_rate_mode, p_unit_divisor, p_divisor_rule_key, p_rate_multiplier, p_multiplier_rule_key,
    p_prorate_on_partial_period);
end; $$;

-- "Edit" = append a new version; the previous open version is closed (frozen) at p_effective_from.
create or replace function public.create_salary_component_version(
  p_component_id uuid, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text default null, p_fixed_amount numeric default null, p_currency text default null,
  p_percentage numeric default null, p_percentage_basis text default null, p_rule_key text default null,
  p_taxable boolean default false, p_insurable boolean default false, p_display_on_payslip boolean default true,
  p_display_order integer default 0, p_change_note text default null,
  p_quantity_source text default null, p_rate_mode text default null, p_unit_divisor numeric default null,
  p_divisor_rule_key text default null, p_rate_multiplier numeric default null, p_multiplier_rule_key text default null,
  p_prorate_on_partial_period boolean default false
) returns public.salary_component_versions
language plpgsql security definer set search_path = public as $$
declare v_prev public.salary_component_versions;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_effective_from is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  perform 1 from public.salary_components where id = p_component_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_prev from public.salary_component_versions
   where component_id = p_component_id and effective_to is null for update;
  if found then
    if p_effective_from < v_prev.effective_from then
      raise exception 'PAYROLL_START_BEFORE_CURRENT' using errcode = '22000';
    end if;
    update public.salary_component_versions set effective_to = p_effective_from, updated_at = now() where id = v_prev.id;
  end if;

  return public._payroll_insert_component_version(
    p_component_id,
    coalesce((select max(version_number) from public.salary_component_versions where component_id = p_component_id), 0) + 1,
    p_name_fa, p_calculation_method, p_effective_from, p_name_en, p_fixed_amount, p_currency, p_percentage,
    p_percentage_basis, p_rule_key, p_taxable, p_insurable, p_display_on_payslip, p_display_order, p_change_note,
    p_quantity_source, p_rate_mode, p_unit_divisor, p_divisor_rule_key, p_rate_multiplier, p_multiplier_rule_key,
    p_prorate_on_partial_period);
end; $$;

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
  -- QUANTITY_X_RATE (Phase 8)
  v_qty numeric; v_qty_unit text; v_unit_rate numeric; v_wage numeric; v_wage_src text; v_div numeric; v_mult numeric;
  v_details jsonb; v_ok boolean; v_used_rule boolean; v_div_rule jsonb; v_mult_rule jsonb; v_expected_unit text;
  -- calendar-day proration (Phase 9)
  v_pdays integer; v_edays integer; v_prorate boolean := false; v_proration jsonb;
begin
  select * into v_calc   from public.payroll_calculations where id = p_calc_id;
  select * into v_batch  from public.payroll_batches where id = v_calc.batch_id;
  select * into v_person from public.personnel where id = p_personnel_id;
  select * into v_wd from public.payroll_work_data where period_id = v_batch.period_id and personnel_id = p_personnel_id;
  v_has_wd := found;

  -- ---- calendar-day proration: employed days / calendar days of the period. A day counts when ANY employment record covers it
  -- (half-open [start_date, end_date): the end date is the first day NOT employed), so overlapping or gapped records never double-count.
  v_pdays := v_calc.period_end - v_calc.period_start + 1;
  select count(*) into v_edays
    from generate_series(0, v_pdays - 1) g
   where exists (select 1 from public.employment_records er
                  where er.personnel_id = p_personnel_id and er.start_date <= v_calc.period_start + g
                    and (er.end_date is null or er.end_date > v_calc.period_start + g));
  v_prorate := (v_edays > 0 and v_edays < v_pdays);
  v_proration := jsonb_build_object('employed_days', v_edays, 'period_days', v_pdays);

  -- ---- person-level notes (codes only) ----
  if v_prorate then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'PARTIAL_PERIOD'); end if;
  -- a part-month flag from the personnel dates but NO usable employment days: nothing is prorated and nothing is silently zeroed
  if (p_partial or v_edays = 0) and not v_prorate then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'PRORATION_NOT_APPLIED');
  end if;
  if p_comp_changed then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'COMPENSATION_CHANGED_IN_PERIOD'); end if;
  if p_override = 'INCLUDE' then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'ELIGIBILITY_OVERRIDDEN'); end if;
  if v_person.employment_status = 'SUSPENDED' then perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'PERSONNEL_SUSPENDED'); end if;
  if not v_has_wd then
    perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'WARNING', 'MISSING_WORK_DATA');
  elsif p_profile_id is not null and exists (
          select 1
            from (values ('OVERTIME_HOURS', v_wd.overtime_hours), ('ABSENCE_HOURS', v_wd.absence_hours),
                         ('ABSENCE_DAYS', v_wd.absence_days), ('UNPAID_LEAVE_DAYS', v_wd.unpaid_leave_days)) q (src, val)
           where coalesce(q.val, 0) > 0
             and not exists (select 1 from public.compensation_lines cl
                               join public.salary_component_versions ver on ver.id = cl.component_version_id
                              where cl.compensation_profile_id = p_profile_id
                                and ver.calculation_method = 'QUANTITY_X_RATE' and ver.quantity_source = q.src)) then
    -- overtime / absence / unpaid-leave numbers exist that no QUANTITY_X_RATE component of this profile uses
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
      -- multiply first, divide last: one division, one final rounding (a full-month person is exactly the pre-Phase-9 number)
      v_base := public._payroll_round(case when v_prorate then v_prof.base_salary * v_edays / v_pdays else v_prof.base_salary end,
                                      v_calc.rounding_scale, v_calc.rounding_mode);
      v_order := 1;
      insert into public.payroll_result_lines (result_id, line_order, component_code, component_name_fa, component_type, method, status, amount, amount_source, details)
      values (v_result, 1, 'BASE_SALARY', 'حقوق پایه', 'EARNING', 'PROFILE_BASE', 'COMPUTED', v_base, 'PROFILE',
              case when v_prorate then jsonb_build_object('proration', v_proration) end);
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
               ver.percentage, ver.percentage_basis as basis, ver.rule_key, ver.taxable, ver.insurable,
               ver.quantity_source, ver.rate_mode, ver.unit_divisor, ver.divisor_rule_key, ver.rate_multiplier, ver.multiplier_rule_key,
               ver.prorate_on_partial_period as prorate
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
        v_qty := null; v_qty_unit := null; v_unit_rate := null; v_details := null;
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
          -- only a FIXED component that the company ticked («در ماه ناقص متناسب شود») is prorated
          if v_raw is not null and v_prorate and v_l.prorate then
            v_raw := v_raw * v_edays / v_pdays;
            v_details := jsonb_build_object('proration', v_proration);
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

        elsif v_l.method = 'QUANTITY_X_RATE' and v_l.quantity_source is not null and v_l.rate_mode is not null then
          -- Phase 8: amount = quantity x rate. Every input is explicit; a missing / invalid one stops THIS line (CRITICAL), never a guess.
          v_qty_unit := case when v_l.quantity_source like '%\_HOURS' escape '\' then 'HOURS' else 'DAYS' end;
          v_ok := true; v_used_rule := false; v_div := null; v_mult := null; v_wage := null; v_wage_src := null;
          v_div_rule := null; v_mult_rule := null;
          v_details := jsonb_build_object('quantity_source', v_l.quantity_source, 'rate_mode', v_l.rate_mode);

          -- quantity: the work-data field. NULL = not entered (CRITICAL); an explicit 0 is a valid zero line.
          if v_has_wd then
            v_qty := case v_l.quantity_source
              when 'OVERTIME_HOURS' then v_wd.overtime_hours   when 'ABSENCE_HOURS' then v_wd.absence_hours
              when 'ABSENCE_DAYS' then v_wd.absence_days       when 'UNPAID_LEAVE_DAYS' then v_wd.unpaid_leave_days
              when 'PAID_LEAVE_DAYS' then v_wd.paid_leave_days when 'MISSION_DAYS' then v_wd.mission_days
              when 'MISSION_HOURS' then v_wd.mission_hours     when 'WORK_DAYS' then v_wd.work_days
              when 'WORK_HOURS' then v_wd.work_hours end;
          end if;
          if v_qty is null then
            perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'QUANTITY_MISSING', v_l.c_code);
            v_ok := false;
          end if;

          if v_ok and v_l.rate_mode = 'PER_UNIT' then
            if v_l.amount_override is not null then
              v_unit_rate := v_l.amount_override; v_rate_src := 'COMPENSATION_OVERRIDE'; v_src := 'COMPENSATION_OVERRIDE';
            elsif v_l.v_currency is distinct from v_calc.currency then
              perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'CURRENCY_MISMATCH', v_l.c_code);
              v_ok := false;
            else
              v_unit_rate := v_l.fixed_amount; v_rate_src := 'COMPONENT'; v_src := 'COMPONENT_DEFAULT';
            end if;
            v_details := v_details || jsonb_build_object('rate_source', v_rate_src);

          elsif v_ok then   -- WAGE_FRACTION: rate = wage / divisor x multiplier
            -- wage: the profile's explicit hourly rate for hour quantities (when set and in the batch currency), else the base salary
            if v_qty_unit = 'HOURS' and v_prof.hourly_rate is not null and v_prof.currency is not distinct from v_calc.currency then
              v_wage := v_prof.hourly_rate; v_wage_src := 'PROFILE_HOURLY';
            else
              v_wage := v_prof.base_salary; v_wage_src := 'BASE_SALARY';
            end if;
            v_details := v_details || jsonb_build_object('wage_source', v_wage_src);

            -- multiplier: a fixed number on the component, or an APPROVED rule (unit RATIO)
            if v_l.rate_multiplier is not null then
              v_mult := v_l.rate_multiplier;
              v_details := v_details || jsonb_build_object('multiplier', v_mult::text, 'multiplier_source', 'COMPONENT');
            else
              select * into v_rule from public._payroll_rule_for_period(v_calc.jurisdiction, v_l.multiplier_rule_key, v_calc.period_start, v_calc.period_end);
              if v_rule.o_status <> 'OK' then
                perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', v_rule.o_status, v_l.c_code, v_l.multiplier_rule_key);
                v_ok := false;
              elsif v_rule.o_value is null or upper(btrim(coalesce(v_rule.o_unit, ''))) <> 'RATIO' or v_rule.o_value < 0 or v_rule.o_value > 10 then
                perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'RULE_VALUE_INVALID', v_l.c_code, v_l.multiplier_rule_key);
                v_ok := false;
              else
                v_mult := v_rule.o_value; v_used_rule := true;
                v_mult_rule := jsonb_build_object('rule_key', v_l.multiplier_rule_key, 'rule_set_id', v_rule.o_rule_set_id, 'rule_entry_id', v_rule.o_entry_id);
                v_details := v_details || jsonb_build_object('multiplier', v_mult::text, 'multiplier_source', 'RULE', 'multiplier_rule', v_mult_rule);
              end if;
            end if;

            -- divisor (units per month; unit must match the quantity's unit). Not used when the wage already IS an hourly rate.
            if v_ok and v_wage_src = 'BASE_SALARY' then
              if v_l.unit_divisor is not null then
                v_div := v_l.unit_divisor;
                v_details := v_details || jsonb_build_object('divisor', v_div::text, 'divisor_source', 'COMPONENT');
              else
                v_expected_unit := v_qty_unit;
                select * into v_rule from public._payroll_rule_for_period(v_calc.jurisdiction, v_l.divisor_rule_key, v_calc.period_start, v_calc.period_end);
                if v_rule.o_status <> 'OK' then
                  perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', v_rule.o_status, v_l.c_code, v_l.divisor_rule_key);
                  v_ok := false;
                elsif v_rule.o_value is null or upper(btrim(coalesce(v_rule.o_unit, ''))) <> v_expected_unit or v_rule.o_value <= 0 or v_rule.o_value > 744 then
                  perform public._payroll_add_warning(p_calc_id, v_calc.batch_id, p_personnel_id, 'CRITICAL', 'RULE_VALUE_INVALID', v_l.c_code, v_l.divisor_rule_key);
                  v_ok := false;
                else
                  v_div := v_rule.o_value; v_used_rule := true;
                  v_div_rule := jsonb_build_object('rule_key', v_l.divisor_rule_key, 'rule_set_id', v_rule.o_rule_set_id, 'rule_entry_id', v_rule.o_entry_id);
                  v_details := v_details || jsonb_build_object('divisor', v_div::text, 'divisor_source', 'RULE', 'divisor_rule', v_div_rule);
                end if;
              end if;
            end if;

            if v_ok then
              v_unit_rate := case when v_wage_src = 'PROFILE_HOURLY' then v_wage * v_mult else v_wage / v_div * v_mult end;
              v_rate_src := case when v_wage_src = 'PROFILE_HOURLY' then 'PROFILE_HOURLY' when v_used_rule then 'RULE' else 'COMPONENT' end;
              v_src := case when v_used_rule then 'RULE' else 'COMPONENT_DEFAULT' end;
            end if;
          end if;

          if v_ok and v_unit_rate is not null then
            -- multiply first, divide last: ONE division, one final rounding (the displayed unit rate is informational)
            if v_l.rate_mode = 'WAGE_FRACTION' and v_wage_src = 'BASE_SALARY' then
              v_raw := v_qty * v_wage * v_mult / v_div;
            elsif v_l.rate_mode = 'WAGE_FRACTION' then
              v_raw := v_qty * v_wage * v_mult;
            else
              v_raw := v_qty * v_unit_rate;
            end if;
          end if;

        else   -- FORMULA, or a QUANTITY_X_RATE definition from before Phase 8 (no parameters): never evaluated, never guessed
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
          taxable, insurable, quantity, quantity_unit, unit_rate, details)
        values (
          v_result, v_order, v_l.component_id, v_l.version_id, v_l.c_code, v_l.name_fa, v_l.c_type,
          v_l.method, v_status, v_amount, v_src, v_basis, v_base_used, v_rate, v_rate_src, v_l.rule_key, v_rule_set, v_rule_entry,
          v_l.taxable, v_l.insurable,
          case when v_status = 'COMPUTED' then v_qty end, case when v_status = 'COMPUTED' then v_qty_unit end,
          case when v_status = 'COMPUTED' then v_unit_rate end, case when v_status = 'COMPUTED' then v_details end);
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
      'proration', v_proration || jsonb_build_object('applied', v_prorate),
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
    p_batch_id, v_batch.calculation_version + 1, 'PAYROLL_ENGINE_3', v_batch.currency, v_batch.jurisdiction,
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

create or replace function public.payroll_payslip_data(p_result_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_r public.payroll_results; v_b public.payroll_batches; v_per public.payroll_periods; v_p public.personnel;
  v_pay record; v_lines jsonb; v_hidden_e numeric; v_hidden_d numeric; v_latest record; v_can boolean; v_reason text;
begin
  if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_r from public.payroll_results where id = p_result_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_b from public.payroll_batches where id = v_r.batch_id;
  if v_b.status <> 'APPROVED' or v_b.approved_calculation_id is distinct from v_r.calculation_id then
    raise exception 'PAYROLL_NOT_APPROVED' using errcode = '22000';
  end if;
  if not v_r.is_complete then raise exception 'PAYSLIP_RESULT_INVALID' using errcode = '22000'; end if;
  select * into v_per from public.payroll_periods where id = v_b.period_id;
  select * into v_p from public.personnel where id = v_r.personnel_id;
  select * into v_pay from public._payroll_result_payment(p_result_id);

  select coalesce(sum(l.amount) filter (where l.component_type = 'EARNING'), 0),
         coalesce(sum(l.amount) filter (where l.component_type = 'DEDUCTION'), 0)
    into v_hidden_e, v_hidden_d
    from public.payroll_result_lines l
    join public.salary_component_versions v on v.id = l.component_version_id
   where l.result_id = p_result_id and l.status = 'COMPUTED' and l.component_type in ('EARNING','DEDUCTION') and not v.display_on_payslip;

  select coalesce(jsonb_agg(x.o order by x.ord), '[]'::jsonb) into v_lines from (
    select l.line_order as ord,
           jsonb_build_object('code', l.component_code, 'name', l.component_name_fa, 'type', l.component_type, 'amount', l.amount::text)
           || case when l.quantity is not null
                   then jsonb_build_object('quantity', l.quantity::text, 'unit', l.quantity_unit, 'unit_rate', l.unit_rate::text)
                   else '{}'::jsonb end
           || case when (l.details -> 'proration') is not null then jsonb_build_object('proration', l.details -> 'proration') else '{}'::jsonb end as o
      from public.payroll_result_lines l
      left join public.salary_component_versions v on v.id = l.component_version_id
     where l.result_id = p_result_id and l.status = 'COMPUTED' and l.component_type in ('EARNING','DEDUCTION')
       and coalesce(v.display_on_payslip, true)
    union all
    select 100000, jsonb_build_object('code', 'OTHER_EARNINGS', 'name', 'سایر مزایا', 'type', 'EARNING', 'amount', v_hidden_e::text) where v_hidden_e > 0
    union all
    select 100001, jsonb_build_object('code', 'OTHER_DEDUCTIONS', 'name', 'سایر کسورات', 'type', 'DEDUCTION', 'amount', v_hidden_d::text) where v_hidden_d > 0
  ) x;

  select s.revision, s.payment_state_at_issue as state into v_latest
    from public.payroll_payslips s where s.result_id = p_result_id order by s.revision desc limit 1;
  v_can := v_latest.revision is null or v_latest.state is distinct from v_pay.state;
  v_reason := case when v_can then null else 'UP_TO_DATE' end;

  return jsonb_build_object(
    'result_id', v_r.id, 'personnel_id', v_r.personnel_id,
    'batch', jsonb_build_object('id', v_b.id, 'batch_number', v_b.batch_number, 'currency', v_b.currency),
    'period', jsonb_build_object('jalali_year', v_per.jalali_year, 'jalali_month', v_per.jalali_month,
                                 'period_start', v_per.period_start, 'period_end', v_per.period_end),
    'personnel', jsonb_build_object('number', v_r.personnel_number, 'name', v_r.personnel_name, 'job_title', v_p.job_title,
                                    'department', v_p.department, 'hire_date', v_p.hire_date),
    'lines', v_lines,
    'totals', jsonb_build_object('gross', v_r.gross::text, 'deductions', v_r.total_deductions::text, 'net', v_r.net::text),
    'payment', jsonb_build_object('state', v_pay.state, 'paid', v_pay.paid::text, 'last_date', v_pay.last_date, 'numbers', to_jsonb(v_pay.numbers)),
    'next_revision', coalesce(v_latest.revision, 0) + 1,
    'latest_revision', v_latest.revision,
    'can_issue', v_can, 'reason', v_reason);
end; $$;

-- ---------------------------------------------------------------------
-- Grants: block PUBLIC default, allow authenticated (tier checks are inside each function). service_role NOT granted.
-- ---------------------------------------------------------------------
revoke execute on function public._payroll_insert_component_version(uuid,integer,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text,boolean) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'create_salary_component(text,text,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text,boolean)',
    'create_salary_component_version(uuid,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text,boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK: re-run 0138's _payroll_calc_personnel / calculate_payroll_batch / payroll_payslip_data and (after dropping the new
--   signatures) 0137's three component write functions; alter table salary_component_versions drop constraint ck_scv_prorate,
--   drop column prorate_on_partial_period.
-- =====================================================================

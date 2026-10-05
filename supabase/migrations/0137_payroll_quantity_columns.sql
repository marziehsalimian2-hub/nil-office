-- =====================================================================
-- NIL Office — 0137_payroll_quantity_columns.sql
-- HR & Payroll — Phase 8 (part 1): schema + write paths for QUANTITY_X_RATE components
-- (automatic overtime / absence calculation; the engine itself is 0138).
--
-- A QUANTITY_X_RATE component version now says WHICH work-data field is the quantity (overtime hours, absence days …)
-- and HOW the rate is obtained:
--   PER_UNIT       rate = fixed_amount per unit (a compensation line may override it per person)
--   WAGE_FRACTION  rate = wage / divisor x multiplier; divisor and multiplier are EACH given exactly one way:
--                  a fixed number on the component, or an APPROVED legal-rule key (resolved at calculation time).
-- NO legal value is seeded or defaulted anywhere: every number is entered by the company (nothing = no guess).
--
-- Additive. The version-immutability triggers (0115) diff the whole row as jsonb, so the new columns are frozen
-- like every other version field. tg_payroll_audit whitelists stay as they are (no amounts / no new fields in logs).
-- Restated from the CURRENT bodies (grep of ALL migrations: only 0116 defines these functions):
--   _payroll_insert_component_version, create_salary_component, create_salary_component_version, create_compensation_version.
-- The old signatures are DROPPED so PostgREST never sees two overloads. service_role is not granted (payroll stays web-only).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) component versions: the six parameters
-- ---------------------------------------------------------------------
alter table public.salary_component_versions
  add column if not exists quantity_source     text,
  add column if not exists rate_mode           text,
  add column if not exists unit_divisor        numeric(12,4),
  add column if not exists divisor_rule_key    text,
  add column if not exists rate_multiplier     numeric(9,4),
  add column if not exists multiplier_rule_key text;

alter table public.salary_component_versions drop constraint if exists ck_scv_fixed;
alter table public.salary_component_versions add constraint ck_scv_fixed
  check (fixed_amount is null or (fixed_amount >= 0 and calculation_method in ('FIXED', 'QUANTITY_X_RATE') and currency is not null));

-- A QUANTITY_X_RATE version created before this phase has none of the parameters ("calculated in a later phase"): the third
-- alternative keeps such legacy rows valid (they may still be closed by a newer version). NEW versions are always complete —
-- _payroll_insert_component_version refuses an incomplete QUANTITY_X_RATE definition — and the engine treats a legacy one as unsupported.
alter table public.salary_component_versions drop constraint if exists ck_scv_quantity;
alter table public.salary_component_versions add constraint ck_scv_quantity check (
  (calculation_method = 'QUANTITY_X_RATE'
     and quantity_source in ('OVERTIME_HOURS', 'ABSENCE_HOURS', 'ABSENCE_DAYS', 'UNPAID_LEAVE_DAYS', 'PAID_LEAVE_DAYS',
                             'MISSION_DAYS', 'MISSION_HOURS', 'WORK_DAYS', 'WORK_HOURS')
     and rate_mode in ('PER_UNIT', 'WAGE_FRACTION')
     and (
       (rate_mode = 'PER_UNIT' and fixed_amount is not null
          and unit_divisor is null and divisor_rule_key is null and rate_multiplier is null and multiplier_rule_key is null)
       or
       (rate_mode = 'WAGE_FRACTION' and fixed_amount is null
          and num_nonnulls(unit_divisor, divisor_rule_key) = 1
          and num_nonnulls(rate_multiplier, multiplier_rule_key) = 1)))
  or
  (calculation_method <> 'QUANTITY_X_RATE'
     and quantity_source is null and rate_mode is null and unit_divisor is null and divisor_rule_key is null
     and rate_multiplier is null and multiplier_rule_key is null)
  or
  (calculation_method = 'QUANTITY_X_RATE'                                          -- legacy, parameter-less
     and quantity_source is null and rate_mode is null and unit_divisor is null and divisor_rule_key is null
     and rate_multiplier is null and multiplier_rule_key is null)
);

alter table public.salary_component_versions drop constraint if exists ck_scv_qty_ranges;
alter table public.salary_component_versions add constraint ck_scv_qty_ranges check (
  (unit_divisor is null or (unit_divisor > 0 and unit_divisor <= 744))
  and (rate_multiplier is null or (rate_multiplier >= 0 and rate_multiplier <= 10))
  and (divisor_rule_key is null or divisor_rule_key ~ '^[a-z][a-z0-9_]{1,63}$')
  and (multiplier_rule_key is null or multiplier_rule_key ~ '^[a-z][a-z0-9_]{1,63}$'));

-- ---------------------------------------------------------------------
-- 2) result lines: what the engine used (so a line can be re-computed by hand)
-- ---------------------------------------------------------------------
alter table public.payroll_result_lines
  add column if not exists quantity      numeric(12,4),
  add column if not exists quantity_unit text,
  add column if not exists unit_rate     numeric(20,6),
  add column if not exists details       jsonb;

alter table public.payroll_result_lines drop constraint if exists ck_payroll_line_quantity_unit;
alter table public.payroll_result_lines add constraint ck_payroll_line_quantity_unit check (quantity_unit is null or quantity_unit in ('HOURS', 'DAYS'));

alter table public.payroll_result_lines drop constraint if exists payroll_result_lines_rate_source_check;
alter table public.payroll_result_lines drop constraint if exists ck_payroll_line_rate_source;
alter table public.payroll_result_lines add constraint ck_payroll_line_rate_source
  check (rate_source is null or rate_source in ('COMPONENT', 'COMPENSATION_OVERRIDE', 'RULE', 'PROFILE_HOURLY'));

-- ---------------------------------------------------------------------
-- 3) write paths (old signatures dropped, new ones carry the six parameters at the END, all optional)
-- ---------------------------------------------------------------------
drop function if exists public._payroll_insert_component_version(uuid,integer,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text);
drop function if exists public.create_salary_component(text,text,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text);
drop function if exists public.create_salary_component_version(uuid,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text);

create or replace function public._payroll_insert_component_version(
  p_component_id uuid, p_version integer, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text, p_fixed_amount numeric, p_currency text, p_percentage numeric, p_percentage_basis text,
  p_rule_key text, p_taxable boolean, p_insurable boolean, p_display_on_payslip boolean,
  p_display_order integer, p_change_note text,
  p_quantity_source text default null, p_rate_mode text default null, p_unit_divisor numeric default null,
  p_divisor_rule_key text default null, p_rate_multiplier numeric default null, p_multiplier_rule_key text default null
) returns public.salary_component_versions
language plpgsql security definer set search_path = public as $$
declare v_type salary_component_type; v_row public.salary_component_versions;
begin
  if p_effective_from is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  if p_name_fa is null or length(btrim(p_name_fa)) = 0 then raise exception 'COMPONENT_NAME_REQUIRED' using errcode = '22000'; end if;
  if p_currency is not null and p_currency not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
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
      quantity_source, rate_mode, unit_divisor, divisor_rule_key, rate_multiplier, multiplier_rule_key)
    values (
      p_component_id, v_type, p_version, btrim(p_name_fa), nullif(btrim(p_name_en), ''),
      p_calculation_method::salary_calculation_method, p_fixed_amount, p_currency, p_percentage,
      p_percentage_basis, nullif(btrim(p_rule_key), ''), coalesce(p_taxable, false), coalesce(p_insurable, false),
      coalesce(p_display_on_payslip, true), coalesce(p_display_order, 0), p_effective_from, p_change_note, auth.uid(),
      nullif(btrim(p_quantity_source), ''), nullif(btrim(p_rate_mode), ''), p_unit_divisor,
      nullif(btrim(p_divisor_rule_key), ''), p_rate_multiplier, nullif(btrim(p_multiplier_rule_key), ''))
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
  p_divisor_rule_key text default null, p_rate_multiplier numeric default null, p_multiplier_rule_key text default null
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
    p_quantity_source, p_rate_mode, p_unit_divisor, p_divisor_rule_key, p_rate_multiplier, p_multiplier_rule_key);
end; $$;

-- "Edit" = append a new version; the previous open version is closed (frozen) at p_effective_from.
create or replace function public.create_salary_component_version(
  p_component_id uuid, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text default null, p_fixed_amount numeric default null, p_currency text default null,
  p_percentage numeric default null, p_percentage_basis text default null, p_rule_key text default null,
  p_taxable boolean default false, p_insurable boolean default false, p_display_on_payslip boolean default true,
  p_display_order integer default 0, p_change_note text default null,
  p_quantity_source text default null, p_rate_mode text default null, p_unit_divisor numeric default null,
  p_divisor_rule_key text default null, p_rate_multiplier numeric default null, p_multiplier_rule_key text default null
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
    p_quantity_source, p_rate_mode, p_unit_divisor, p_divisor_rule_key, p_rate_multiplier, p_multiplier_rule_key);
end; $$;

-- ---------------------------------------------------------------------
-- create_compensation_version: CURRENT body (0116) + amount_override for QUANTITY_X_RATE / PER_UNIT
-- ---------------------------------------------------------------------
create or replace function public.create_compensation_version(
  p_personnel_id uuid, p_effective_from date, p_base_salary numeric, p_currency text, p_payment_frequency text,
  p_hourly_rate numeric default null, p_notes text default null, p_lines jsonb default '[]'::jsonb
) returns public.compensation_profiles
language plpgsql security definer set search_path = public as $$
declare
  v_prev public.compensation_profiles; v_row public.compensation_profiles;
  v_line jsonb; v_comp public.salary_components; v_ver public.salary_component_versions;
  v_cid uuid; v_amt numeric; v_pct numeric; v_seen uuid[] := '{}';
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_effective_from is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  if p_base_salary is null or p_base_salary < 0 or (p_hourly_rate is not null and p_hourly_rate < 0) then
    raise exception 'INVALID_AMOUNT' using errcode = '22000';
  end if;
  if p_currency is null or p_currency not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
  end if;
  if p_payment_frequency is null or p_payment_frequency not in ('MONTHLY','BIWEEKLY','WEEKLY','DAILY','HOURLY','OTHER') then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;
  if p_payment_frequency = 'HOURLY' and p_hourly_rate is null then
    raise exception 'HOURLY_RATE_REQUIRED' using errcode = '22000';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;

  perform 1 from public.personnel where id = p_personnel_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_prev from public.compensation_profiles
   where personnel_id = p_personnel_id and effective_to is null for update;
  if found then
    if p_effective_from < v_prev.effective_from then
      raise exception 'PAYROLL_START_BEFORE_CURRENT' using errcode = '22000';
    end if;
    update public.compensation_profiles set effective_to = p_effective_from, updated_at = now() where id = v_prev.id;
  end if;

  insert into public.compensation_profiles (
    personnel_id, version_number, effective_from, base_salary, currency, payment_frequency,
    hourly_rate, notes, created_by)
  values (
    p_personnel_id,
    coalesce((select max(version_number) from public.compensation_profiles where personnel_id = p_personnel_id), 0) + 1,
    p_effective_from, p_base_salary, p_currency, p_payment_frequency, p_hourly_rate,
    nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_row;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    begin
      v_cid := nullif(v_line ->> 'component_id', '')::uuid;
      v_amt := nullif(v_line ->> 'amount_override', '')::numeric;
      v_pct := nullif(v_line ->> 'percentage_override', '')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'INVALID_VALUE' using errcode = '22000';
    end;
    if v_cid is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
    if v_cid = any(v_seen) then raise exception 'LINE_DUPLICATE_COMPONENT' using errcode = '22000'; end if;
    v_seen := v_seen || v_cid;

    select * into v_comp from public.salary_components where id = v_cid;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_comp.code = 'BASE_SALARY' then raise exception 'BASE_SALARY_IS_PROFILE_FIELD' using errcode = '22000'; end if;
    if not v_comp.is_active then raise exception 'COMPONENT_INACTIVE' using errcode = '22000'; end if;

    -- Pin the definition in force on the compensation start date ("no definition = no guess").
    select * into v_ver from public.salary_component_versions
     where component_id = v_cid and effective_from <= p_effective_from
       and (effective_to is null or p_effective_from < effective_to)
     order by version_number desc limit 1;
    if not found then raise exception 'COMPONENT_NOT_EFFECTIVE' using errcode = '22000'; end if;

    if v_amt is not null and v_pct is not null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
    if v_amt is not null then
      -- a per-person amount override exists for FIXED components and for QUANTITY_X_RATE / PER_UNIT (a contractual rate per unit)
      if v_ver.rule_key is not null
         or not (v_ver.calculation_method = 'FIXED' or (v_ver.calculation_method = 'QUANTITY_X_RATE' and v_ver.rate_mode = 'PER_UNIT')) then
        raise exception 'COMPONENT_OVERRIDE_NOT_ALLOWED' using errcode = '22000';
      end if;
      if v_amt < 0 then raise exception 'INVALID_AMOUNT' using errcode = '22000'; end if;
    end if;
    if v_pct is not null then
      if v_ver.calculation_method <> 'PERCENTAGE' or v_ver.rule_key is not null then
        raise exception 'COMPONENT_OVERRIDE_NOT_ALLOWED' using errcode = '22000';
      end if;
      if v_pct < 0 or v_pct > 100 then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
    end if;
    if v_ver.calculation_method = 'QUANTITY_X_RATE' and (v_ver.quantity_source is null or v_ver.rate_mode is null) then
      raise exception 'COMPONENT_INVALID_COMBINATION' using errcode = '22000';       -- a QUANTITY_X_RATE definition without its quantity source / rate mode
    end if;
    if v_amt is null and v_ver.calculation_method = 'QUANTITY_X_RATE' and v_ver.rate_mode = 'PER_UNIT'
       and v_ver.currency is distinct from p_currency then
      raise exception 'COMPONENT_CURRENCY_MISMATCH' using errcode = '22000';
    end if;
    if v_amt is null and v_ver.calculation_method = 'FIXED' then
      if v_ver.fixed_amount is null then raise exception 'COMPONENT_AMOUNT_MISSING' using errcode = '22000'; end if;
      if v_ver.currency is distinct from p_currency then raise exception 'COMPONENT_CURRENCY_MISMATCH' using errcode = '22000'; end if;
    end if;
    if v_pct is null and v_ver.calculation_method = 'PERCENTAGE' and v_ver.rule_key is null and v_ver.percentage is null then
      raise exception 'COMPONENT_AMOUNT_MISSING' using errcode = '22000';
    end if;

    insert into public.compensation_lines (
      compensation_profile_id, component_id, component_version_id, amount_override, percentage_override, notes)
    values (v_row.id, v_cid, v_ver.id, v_amt, v_pct, nullif(btrim(v_line ->> 'notes'), ''));
  end loop;

  -- Component ids only — never amounts.
  perform public.write_log('compensation_profiles', v_row.id, 'LINES_SET', null,
    jsonb_build_object('component_ids', to_jsonb(v_seen)));
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- Grants: block PUBLIC default, allow authenticated (tier checks are inside each function). service_role NOT granted.
-- ---------------------------------------------------------------------
revoke execute on function public._payroll_insert_component_version(uuid,integer,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'create_salary_component(text,text,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text)',
    'create_salary_component_version(uuid,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text,text,text,numeric,text,numeric,text)',
    'create_compensation_version(uuid,date,numeric,text,text,numeric,text,jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK: re-run 0116's definitions of _payroll_insert_component_version / create_salary_component /
--   create_salary_component_version / create_compensation_version after dropping the new signatures;
--   alter table salary_component_versions drop columns quantity_source, rate_mode, unit_divisor, divisor_rule_key,
--   rate_multiplier, multiplier_rule_key (+ constraints ck_scv_quantity / ck_scv_qty_ranges; restore ck_scv_fixed);
--   alter table payroll_result_lines drop columns quantity, quantity_unit, unit_rate, details (restore the rate_source check).
-- =====================================================================

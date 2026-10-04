-- =====================================================================
-- NIL Office — 0116_payroll_config_functions.sql
-- HR & Payroll — Phase 2 — the ONLY sanctioned write paths (SECURITY
-- DEFINER, tier-checked inside). Audit comes from tg_payroll_audit
-- (0115); RPCs add semantic logs only where a trigger cannot (line
-- component ids, reveal). write_log payloads NEVER contain amounts or
-- bank values, and NEVER use entity_type 'personnel' (HR can read
-- those rows).
-- =====================================================================

-- ---------- internal helper (not callable by users) ----------
create or replace function public._payroll_insert_component_version(
  p_component_id uuid, p_version integer, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text, p_fixed_amount numeric, p_currency text, p_percentage numeric, p_percentage_basis text,
  p_rule_key text, p_taxable boolean, p_insurable boolean, p_display_on_payslip boolean,
  p_display_order integer, p_change_note text
) returns public.salary_component_versions
language plpgsql security definer set search_path = public as $$
declare v_type salary_component_type; v_row public.salary_component_versions;
begin
  if p_effective_from is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  if p_name_fa is null or length(btrim(p_name_fa)) = 0 then raise exception 'COMPONENT_NAME_REQUIRED' using errcode = '22000'; end if;
  if p_currency is not null and p_currency not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
  end if;
  select component_type into v_type from public.salary_components where id = p_component_id;
  begin
    insert into public.salary_component_versions (
      component_id, component_type, version_number, name_fa, name_en, calculation_method,
      fixed_amount, currency, percentage, percentage_basis, rule_key, taxable, insurable,
      display_on_payslip, display_order, effective_from, change_note, created_by)
    values (
      p_component_id, v_type, p_version, btrim(p_name_fa), nullif(btrim(p_name_en), ''),
      p_calculation_method::salary_calculation_method, p_fixed_amount, p_currency, p_percentage,
      p_percentage_basis, nullif(btrim(p_rule_key), ''), coalesce(p_taxable, false), coalesce(p_insurable, false),
      coalesce(p_display_on_payslip, true), coalesce(p_display_order, 0), p_effective_from, p_change_note, auth.uid())
    returning * into v_row;
  exception
    when check_violation then raise exception 'COMPONENT_INVALID_COMBINATION' using errcode = '22000';
    when invalid_text_representation then raise exception 'INVALID_VALUE' using errcode = '22000';
  end;
  return v_row;
end; $$;
revoke execute on function public._payroll_insert_component_version(uuid,integer,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text) from public, anon, authenticated;

-- ---------- salary components ----------
create or replace function public.create_salary_component(
  p_code text, p_component_type text, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text default null, p_fixed_amount numeric default null, p_currency text default null,
  p_percentage numeric default null, p_percentage_basis text default null, p_rule_key text default null,
  p_taxable boolean default false, p_insurable boolean default false, p_display_on_payslip boolean default true,
  p_display_order integer default 0, p_change_note text default null
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
    p_taxable, p_insurable, p_display_on_payslip, p_display_order, p_change_note);
end; $$;

-- "Edit" = append a new version; the previous open version is closed (frozen) at p_effective_from.
create or replace function public.create_salary_component_version(
  p_component_id uuid, p_name_fa text, p_calculation_method text, p_effective_from date,
  p_name_en text default null, p_fixed_amount numeric default null, p_currency text default null,
  p_percentage numeric default null, p_percentage_basis text default null, p_rule_key text default null,
  p_taxable boolean default false, p_insurable boolean default false, p_display_on_payslip boolean default true,
  p_display_order integer default 0, p_change_note text default null
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
    p_percentage_basis, p_rule_key, p_taxable, p_insurable, p_display_on_payslip, p_display_order, p_change_note);
end; $$;

create or replace function public.set_salary_component_active(p_component_id uuid, p_active boolean)
returns public.salary_components
language plpgsql security definer set search_path = public as $$
declare v_row public.salary_components;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  update public.salary_components set is_active = coalesce(p_active, true), updated_at = now()
   where id = p_component_id returning * into v_row;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return v_row;
end; $$;

-- ---------- compensation ----------
-- p_lines: jsonb array of {component_id, amount_override, percentage_override, notes}; overrides as STRINGS (exact).
-- The client sends component_id only; the RPC pins the version in force on p_effective_from.
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
      if v_ver.calculation_method <> 'FIXED' or v_ver.rule_key is not null then
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

-- ---------- employee payment destinations (bank tier only) ----------
create or replace function public.add_payment_destination(
  p_personnel_id uuid, p_bank_name text, p_account_holder_name text,
  p_account_number text default null, p_iban text default null, p_card_number text default null,
  p_is_primary boolean default false, p_notes text default null
) returns public.personnel_payment_destinations
language plpgsql security definer set search_path = public as $$
declare
  v_iban text := nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), '');
  v_card text := nullif(regexp_replace(coalesce(p_card_number, ''), '[\s-]', '', 'g'), '');
  v_acct text := nullif(regexp_replace(coalesce(p_account_number, ''), '[\s]', '', 'g'), '');
  v_row public.personnel_payment_destinations; v_primary boolean := coalesce(p_is_primary, false);
begin
  if not public.can_view_payroll_bank_details() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_bank_name is null or length(btrim(p_bank_name)) = 0
     or p_account_holder_name is null or length(btrim(p_account_holder_name)) = 0 then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;
  if v_iban is null and v_card is null and v_acct is null then
    raise exception 'PAYMENT_DEST_IDENTIFIER_REQUIRED' using errcode = '22000';
  end if;
  if v_iban is not null and v_iban !~ '^IR[0-9]{24}$' then raise exception 'PAYMENT_DEST_IBAN_INVALID' using errcode = '22000'; end if;
  if v_card is not null and v_card !~ '^[0-9]{16}$' then raise exception 'PAYMENT_DEST_CARD_INVALID' using errcode = '22000'; end if;
  if v_acct is not null and length(v_acct) not between 3 and 40 then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;

  perform 1 from public.personnel where id = p_personnel_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- First active destination becomes primary automatically.
  if not exists (select 1 from public.personnel_payment_destinations
                  where personnel_id = p_personnel_id and is_active and is_primary) then
    v_primary := true;
  end if;
  if v_primary then
    update public.personnel_payment_destinations set is_primary = false, updated_by = auth.uid(), updated_at = now()
     where personnel_id = p_personnel_id and is_primary;
  end if;

  insert into public.personnel_payment_destinations (
    personnel_id, bank_name, account_holder_name, account_number, iban, card_number, is_primary, notes, created_by)
  values (p_personnel_id, btrim(p_bank_name), btrim(p_account_holder_name), v_acct, v_iban, v_card,
          v_primary, nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.set_primary_payment_destination(p_id uuid)
returns public.personnel_payment_destinations
language plpgsql security definer set search_path = public as $$
declare v_row public.personnel_payment_destinations;
begin
  if not public.can_view_payroll_bank_details() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.personnel_payment_destinations where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_row.is_active then raise exception 'PAYMENT_DEST_DEACTIVATED' using errcode = '22000'; end if;
  update public.personnel_payment_destinations set is_primary = false, updated_by = auth.uid(), updated_at = now()
   where personnel_id = v_row.personnel_id and is_primary and id <> p_id;
  update public.personnel_payment_destinations set is_primary = true, updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.deactivate_payment_destination(p_id uuid)
returns public.personnel_payment_destinations
language plpgsql security definer set search_path = public as $$
declare v_row public.personnel_payment_destinations;
begin
  if not public.can_view_payroll_bank_details() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  update public.personnel_payment_destinations
     set is_active = false, is_primary = false, updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into v_row;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return v_row;
end; $$;

-- Full values are only ever returned through this audited call; the audit row carries no values.
create or replace function public.reveal_payment_destination(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.personnel_payment_destinations;
begin
  if not public.can_view_payroll_bank_details() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.personnel_payment_destinations where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.write_log('personnel_payment_destinations', p_id, 'REVEALED', null, null);
  return jsonb_build_object('account_number', v_row.account_number, 'iban', v_row.iban, 'card_number', v_row.card_number);
end; $$;

-- ---------- legal rule sets ----------
create or replace function public.create_legal_rule_set(
  p_name text, p_jurisdiction text, p_effective_from date, p_effective_to date default null,
  p_source_reference text default null, p_copy_from_id uuid default null
) returns public.legal_rule_sets
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_jur text := btrim(coalesce(p_jurisdiction, '')); v_row public.legal_rule_sets;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if length(v_name) = 0 or length(v_jur) = 0 then raise exception 'RULE_SET_NAME_REQUIRED' using errcode = '22000'; end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to <= p_effective_from) then
    raise exception 'EFFECTIVE_RANGE_INVALID' using errcode = '22000';
  end if;
  if p_copy_from_id is not null and not exists (select 1 from public.legal_rule_sets where id = p_copy_from_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('legal_rule_set:' || v_jur || ':' || v_name));
  insert into public.legal_rule_sets (name, jurisdiction, version_number, effective_from, effective_to, source_reference, created_by)
  values (v_name, v_jur,
    coalesce((select max(version_number) from public.legal_rule_sets where jurisdiction = v_jur and name = v_name), 0) + 1,
    p_effective_from, p_effective_to, nullif(btrim(p_source_reference), ''), auth.uid())
  returning * into v_row;
  if p_copy_from_id is not null then
    insert into public.legal_rule_entries (rule_set_id, rule_key, value_numeric, value_json, unit, description, source_reference, created_by)
    select v_row.id, rule_key, value_numeric, value_json, unit, description, source_reference, auth.uid()
      from public.legal_rule_entries where rule_set_id = p_copy_from_id;
  end if;
  return v_row;
end; $$;

create or replace function public.update_legal_rule_set_header(
  p_id uuid, p_effective_from date, p_effective_to date default null, p_source_reference text default null
) returns public.legal_rule_sets
language plpgsql security definer set search_path = public as $$
declare v_row public.legal_rule_sets;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.legal_rule_sets where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'DRAFT' then raise exception 'RULE_SET_NOT_DRAFT' using errcode = '22000'; end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to <= p_effective_from) then
    raise exception 'EFFECTIVE_RANGE_INVALID' using errcode = '22000';
  end if;
  update public.legal_rule_sets set effective_from = p_effective_from, effective_to = p_effective_to,
         source_reference = nullif(btrim(p_source_reference), ''), updated_at = now()
   where id = p_id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.upsert_legal_rule_entry(
  p_rule_set_id uuid, p_rule_key text, p_value_numeric numeric default null, p_value_json jsonb default null,
  p_unit text default null, p_description text default null, p_source_reference text default null
) returns public.legal_rule_entries
language plpgsql security definer set search_path = public as $$
declare v_set public.legal_rule_sets; v_key text := btrim(coalesce(p_rule_key, '')); v_row public.legal_rule_entries;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_set from public.legal_rule_sets where id = p_rule_set_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_set.status <> 'DRAFT' then raise exception 'RULE_SET_NOT_DRAFT' using errcode = '22000'; end if;
  if v_key !~ '^[a-z][a-z0-9_]{1,63}$' then raise exception 'RULE_ENTRY_KEY_INVALID' using errcode = '22000'; end if;
  if p_value_numeric is null and p_value_json is null then raise exception 'RULE_ENTRY_VALUE_REQUIRED' using errcode = '22000'; end if;
  begin
    insert into public.legal_rule_entries (rule_set_id, rule_key, value_numeric, value_json, unit, description, source_reference, created_by)
    values (p_rule_set_id, v_key, p_value_numeric, p_value_json, nullif(btrim(p_unit), ''),
            nullif(btrim(p_description), ''), nullif(btrim(p_source_reference), ''), auth.uid())
    on conflict (rule_set_id, rule_key) do update
      set value_numeric = excluded.value_numeric, value_json = excluded.value_json, unit = excluded.unit,
          description = excluded.description, source_reference = excluded.source_reference, updated_at = now()
    returning * into v_row;
  exception when check_violation then raise exception 'INVALID_VALUE' using errcode = '22000';
  end;
  return v_row;
end; $$;

create or replace function public.delete_legal_rule_entry(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_set uuid; v_status legal_rule_set_status;
begin
  if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select rule_set_id into v_set from public.legal_rule_entries where id = p_entry_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select status into v_status from public.legal_rule_sets where id = v_set for update;
  if v_status <> 'DRAFT' then raise exception 'RULE_SET_NOT_DRAFT' using errcode = '22000'; end if;
  delete from public.legal_rule_entries where id = p_entry_id;
end; $$;

-- Server-controlled transitions (lookup table + tier). Creator may approve: recorded, not blocked.
create or replace function public.change_legal_rule_set_status(p_id uuid, p_new_status text, p_note text default null)
returns public.legal_rule_sets
language plpgsql security definer set search_path = public as $$
declare v_row public.legal_rule_sets; v_new legal_rule_set_status; v_tier text;
begin
  select * into v_row from public.legal_rule_sets where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  begin
    v_new := p_new_status::legal_rule_set_status;
  exception when invalid_text_representation then raise exception 'INVALID_VALUE' using errcode = '22000';
  end;
  select required_tier into v_tier from public.legal_rule_set_transitions
   where from_status = v_row.status and to_status = v_new;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;

  if v_tier = 'ADMIN' then
    if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;

  if (v_new = 'RETIRED' or (v_row.status = 'REVIEWED' and v_new = 'DRAFT')) and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'REASON_REQUIRED' using errcode = '22000';
  end if;

  if v_new = 'APPROVED' then
    perform pg_advisory_xact_lock(hashtext('legal_rule_approve:' || v_row.jurisdiction));
    if not exists (select 1 from public.legal_rule_entries where rule_set_id = p_id) then
      raise exception 'RULE_SET_EMPTY' using errcode = '22000';
    end if;
    -- A rule_key must resolve unambiguously on any date: no overlapping APPROVED set in the
    -- same jurisdiction may define the same rule_key (btree_gist not enabled; enforced here).
    if exists (
      select 1
        from public.legal_rule_sets o
        join public.legal_rule_entries oe on oe.rule_set_id = o.id
        join public.legal_rule_entries e  on e.rule_set_id = p_id and e.rule_key = oe.rule_key
       where o.id <> p_id and o.status = 'APPROVED' and o.jurisdiction = v_row.jurisdiction
         and daterange(o.effective_from, o.effective_to, '[)') && daterange(v_row.effective_from, v_row.effective_to, '[)')
    ) then
      raise exception 'RULE_SET_OVERLAP' using errcode = '22000';
    end if;
  end if;

  update public.legal_rule_sets set
    status = v_new,
    status_note = nullif(btrim(p_note), ''),
    reviewed_by = case when v_new = 'REVIEWED' then auth.uid() when v_new = 'DRAFT' then null else reviewed_by end,
    reviewed_at = case when v_new = 'REVIEWED' then now()      when v_new = 'DRAFT' then null else reviewed_at end,
    approved_by = case when v_new = 'APPROVED' then auth.uid() else approved_by end,
    approved_at = case when v_new = 'APPROVED' then now()      else approved_at end,
    retired_by  = case when v_new = 'RETIRED'  then auth.uid() else retired_by end,
    retired_at  = case when v_new = 'RETIRED'  then now()      else retired_at end,
    updated_at = now()
   where id = p_id returning * into v_row;
  return v_row;
end; $$;

-- Grants: block PUBLIC default, allow authenticated (tier checks are inside each function).
do $$
declare f text;
begin
  foreach f in array array[
    'create_salary_component(text,text,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text)',
    'create_salary_component_version(uuid,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text)',
    'set_salary_component_active(uuid,boolean)',
    'create_compensation_version(uuid,date,numeric,text,text,numeric,text,jsonb)',
    'add_payment_destination(uuid,text,text,text,text,text,boolean,text)',
    'set_primary_payment_destination(uuid)',
    'deactivate_payment_destination(uuid)',
    'reveal_payment_destination(uuid)',
    'create_legal_rule_set(text,text,date,date,text,uuid)',
    'update_legal_rule_set_header(uuid,date,date,text)',
    'upsert_legal_rule_entry(uuid,text,numeric,jsonb,text,text,text)',
    'delete_legal_rule_entry(uuid)',
    'change_legal_rule_set_status(uuid,text,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK: drop function if exists public.<each function above with its signature>;
-- plus public._payroll_insert_component_version(uuid,integer,text,text,date,text,numeric,text,numeric,text,text,boolean,boolean,boolean,integer,text)
-- =====================================================================

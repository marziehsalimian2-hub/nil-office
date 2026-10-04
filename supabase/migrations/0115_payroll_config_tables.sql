-- =====================================================================
-- NIL Office — 0115_payroll_config_tables.sql
-- HR & Payroll — Phase 2 — configuration schema ONLY. NO payroll
-- calculation, work data, batches, payslips, payments or accounting links.
--
-- TABLES START EMPTY (spec: no hardcoded legal values). The only rows
-- inserted by any Phase 2 migration are the 6 workflow rows of
-- legal_rule_set_transitions (reference data, like personnel_status_transitions).
--
-- DATE SEMANTICS (all Phase 2 tables): effective_from inclusive,
-- effective_to EXCLUSIVE (= first day it no longer applies); null = open.
-- Same as employment_records [start_date,end_date) (0110).
--
-- ALL writes go through SECURITY DEFINER RPCs (0116); no INSERT/UPDATE/
-- DELETE policy exists (0117). Triggers below are the DB-level backstop.
-- FORMULA / QUANTITY_X_RATE: enum values only. There is NO formula
-- column: nothing unvalidated can land in the DB; evaluation is a later phase.
--
-- AUDIT: never the generic tg_audit() here (it reads new.id and copies
-- the whole row into activity_logs, readable by every active user — see
-- 0113). tg_payroll_audit logs only whitelisted non-sensitive columns
-- plus changed FIELD NAMES.
-- =====================================================================

do $$ begin create type salary_component_type as enum ('EARNING','DEDUCTION','EMPLOYER_COST','INFORMATIONAL');
exception when duplicate_object then null; end $$;
do $$ begin create type salary_calculation_method as enum ('FIXED','PERCENTAGE','QUANTITY_X_RATE','FORMULA','MANUAL_INPUT');
exception when duplicate_object then null; end $$;
do $$ begin create type legal_rule_set_status as enum ('DRAFT','REVIEWED','APPROVED','RETIRED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Salary components: identity + append-only versions
-- ---------------------------------------------------------------------
create table if not exists public.salary_components (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  component_type salary_component_type not null,
  is_active      boolean not null default true,
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_salary_components_code unique (code),
  constraint uq_salary_components_id_type unique (id, component_type),
  constraint ck_salary_components_code check (code ~ '^[A-Z][A-Z0-9_]{1,39}$')
);

create table if not exists public.salary_component_versions (
  id                 uuid primary key default gen_random_uuid(),
  component_id       uuid not null,
  component_type     salary_component_type not null,   -- denormalised so CHECKs can see it
  version_number     int  not null,
  name_fa            text not null,
  name_en            text,
  calculation_method salary_calculation_method not null,
  fixed_amount       numeric(20,4),
  currency           text,
  percentage         numeric(9,4),
  percentage_basis   text,
  rule_key           text,          -- statutory binding resolved at calc time from an APPROVED rule set (no rule = no guess)
  taxable            boolean not null default false,
  insurable          boolean not null default false,
  display_on_payslip boolean not null default true,
  display_order      int not null default 0,
  effective_from     date not null,
  effective_to       date,
  change_note        text,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fk_scv_component foreign key (component_id, component_type)
    references public.salary_components (id, component_type) on delete restrict,
  constraint uq_scv_component_version unique (component_id, version_number),
  constraint uq_scv_id_component unique (id, component_id),
  constraint ck_scv_name check (length(btrim(name_fa)) > 0),
  constraint ck_scv_dates check (effective_to is null or effective_to >= effective_from),
  constraint ck_scv_currency check (currency is null or currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  constraint ck_scv_fixed check (fixed_amount is null or (fixed_amount >= 0 and calculation_method = 'FIXED' and currency is not null)),
  constraint ck_scv_pct check (percentage is null or (percentage between 0 and 100 and calculation_method = 'PERCENTAGE')),
  constraint ck_scv_basis check ((calculation_method = 'PERCENTAGE') = (percentage_basis is not null)
                                 and (percentage_basis is null or percentage_basis in ('BASE_SALARY','GROSS_EARNINGS'))),
  constraint ck_scv_rule_key check (rule_key is null or (
      calculation_method in ('PERCENTAGE','FORMULA') and fixed_amount is null and percentage is null
      and rule_key ~ '^[a-z][a-z0-9_]{1,63}$')),
  constraint ck_scv_flags check (not (taxable or insurable) or component_type = 'EARNING')
);
create unique index if not exists uq_scv_one_open on public.salary_component_versions (component_id) where effective_to is null;
create index if not exists idx_scv_component on public.salary_component_versions (component_id, effective_from);

-- ---------------------------------------------------------------------
-- Compensation: one row per VERSION per personnel (+ immutable lines)
-- ---------------------------------------------------------------------
create table if not exists public.compensation_profiles (
  id                uuid primary key default gen_random_uuid(),
  personnel_id      uuid not null references public.personnel(id) on delete restrict,
  version_number    int  not null,
  effective_from    date not null,
  effective_to      date,
  base_salary       numeric(20,4) not null check (base_salary >= 0),
  currency          text not null check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),  -- no default: Rial/Toman must be explicit
  payment_frequency text not null check (payment_frequency in ('MONTHLY','BIWEEKLY','WEEKLY','DAILY','HOURLY','OTHER')),
  hourly_rate       numeric(20,4) check (hourly_rate is null or hourly_rate >= 0),
  notes             text,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_compensation_version unique (personnel_id, version_number),
  constraint ck_compensation_dates check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists uq_compensation_one_open on public.compensation_profiles (personnel_id) where effective_to is null;
create index if not exists idx_compensation_personnel on public.compensation_profiles (personnel_id, effective_from);

create table if not exists public.compensation_lines (
  id                      uuid primary key default gen_random_uuid(),
  compensation_profile_id uuid not null references public.compensation_profiles(id) on delete restrict,
  component_id            uuid not null,
  component_version_id    uuid not null,
  amount_override         numeric(20,4) check (amount_override is null or amount_override >= 0),
  percentage_override     numeric(9,4)  check (percentage_override is null or percentage_override between 0 and 100),
  notes                   text,
  created_at              timestamptz not null default now(),
  constraint fk_cl_version foreign key (component_version_id, component_id)
    references public.salary_component_versions (id, component_id) on delete restrict,
  constraint uq_cl_one_per_component unique (compensation_profile_id, component_id),
  constraint ck_cl_one_override check (amount_override is null or percentage_override is null)
);
create index if not exists idx_cl_profile on public.compensation_lines (compensation_profile_id);

-- ---------------------------------------------------------------------
-- Employee payment destination (SENSITIVE; plaintext at rest — no crypto
-- exists in this codebase; protected by RLS + masking + redacted audit)
-- ---------------------------------------------------------------------
create table if not exists public.personnel_payment_destinations (
  id                  uuid primary key default gen_random_uuid(),
  personnel_id        uuid not null references public.personnel(id) on delete restrict,
  bank_name           text not null,
  account_holder_name text not null,
  account_number      text,
  iban                text,
  card_number         text,
  is_primary          boolean not null default false,
  is_active           boolean not null default true,
  notes               text,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  constraint ck_ppd_identifier check (num_nonnulls(account_number, iban, card_number) >= 1),
  constraint ck_ppd_iban check (iban is null or iban ~ '^IR[0-9]{24}$'),
  constraint ck_ppd_card check (card_number is null or card_number ~ '^[0-9]{16}$'),
  constraint ck_ppd_account check (account_number is null or length(account_number) between 3 and 40),
  constraint ck_ppd_primary_active check (not is_primary or is_active)
);
create unique index if not exists uq_ppd_one_primary on public.personnel_payment_destinations (personnel_id) where is_primary and is_active;
create index if not exists idx_ppd_personnel on public.personnel_payment_destinations (personnel_id);

-- ---------------------------------------------------------------------
-- Legal rule sets (NO seed data)
-- ---------------------------------------------------------------------
create table if not exists public.legal_rule_sets (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  jurisdiction     text not null,
  version_number   int  not null,
  effective_from   date not null,
  effective_to     date,
  source_reference text,
  status           legal_rule_set_status not null default 'DRAFT',
  status_note      text,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  reviewed_by      uuid references public.profiles(id),
  reviewed_at      timestamptz,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  retired_by       uuid references public.profiles(id),
  retired_at       timestamptz,
  updated_at       timestamptz not null default now(),
  constraint uq_legal_rule_set_version unique (jurisdiction, name, version_number),
  constraint ck_lrs_names check (length(btrim(name)) > 0 and length(btrim(jurisdiction)) > 0),
  constraint ck_lrs_dates check (effective_to is null or effective_to >= effective_from),
  constraint ck_lrs_approved_stamp check (status <> 'APPROVED' or (approved_by is not null and approved_at is not null))
);
create index if not exists idx_lrs_status on public.legal_rule_sets (status, jurisdiction);

create table if not exists public.legal_rule_entries (
  id               uuid primary key default gen_random_uuid(),
  rule_set_id      uuid not null references public.legal_rule_sets(id) on delete restrict,
  rule_key         text not null check (rule_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value_numeric    numeric(20,6),
  value_json       jsonb,           -- DATA ONLY (e.g. brackets); never evaluated; per-key schema validation is a calc-phase job
  unit             text,
  description      text,
  source_reference text,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_lre_key unique (rule_set_id, rule_key),
  constraint ck_lre_value check (num_nonnulls(value_numeric, value_json) >= 1),
  constraint ck_lre_json check (value_json is null or (jsonb_typeof(value_json) in ('object','array') and pg_column_size(value_json) <= 65536))
);

create table if not exists public.legal_rule_set_transitions (
  from_status   legal_rule_set_status not null,
  to_status     legal_rule_set_status not null,
  required_tier text not null check (required_tier in ('APPROVE','ADMIN')),
  primary key (from_status, to_status)
);
insert into public.legal_rule_set_transitions (from_status, to_status, required_tier) values
  ('DRAFT','REVIEWED','APPROVE'), ('REVIEWED','DRAFT','APPROVE'), ('REVIEWED','APPROVED','APPROVE'),
  ('DRAFT','RETIRED','APPROVE'),  ('REVIEWED','RETIRED','APPROVE'), ('APPROVED','RETIRED','ADMIN')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.tg_payroll_no_delete() returns trigger language plpgsql as $$
begin raise exception 'PAYROLL_NO_DELETE' using errcode = '22000'; end; $$;

-- Closed version = frozen; open version = frozen except effective_to (the close).
create or replace function public.tg_versioned_row_immutability() returns trigger language plpgsql as $$
begin
  if old.effective_to is not null then
    raise exception 'PAYROLL_VERSION_CLOSED_IMMUTABLE' using errcode = '22000';
  end if;
  if (to_jsonb(new) - 'effective_to' - 'updated_at') is distinct from (to_jsonb(old) - 'effective_to' - 'updated_at') then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_payroll_frozen() returns trigger language plpgsql as $$
begin raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000'; end; $$;

create or replace function public.tg_salary_components_guard() returns trigger language plpgsql as $$
begin
  if new.code is distinct from old.code or new.component_type is distinct from old.component_type
     or new.created_by is distinct from old.created_by then
    raise exception 'COMPONENT_CODE_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_payment_destination_guard() returns trigger language plpgsql as $$
declare v_mut text[] := array['is_primary','is_active','notes','updated_by','updated_at'];
begin
  if (to_jsonb(new) - v_mut) is distinct from (to_jsonb(old) - v_mut) then
    raise exception 'PAYMENT_DEST_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  if old.is_active = false and new.is_active = true then
    raise exception 'PAYMENT_DEST_DEACTIVATED' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_legal_rule_sets_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'RETIRED' then
    raise exception 'RULE_SET_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  if new.status is distinct from old.status and not exists (
       select 1 from public.legal_rule_set_transitions where from_status = old.status and to_status = new.status) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;
  if new.name is distinct from old.name or new.jurisdiction is distinct from old.jurisdiction
     or new.version_number is distinct from old.version_number or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'RULE_SET_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  if old.status <> 'DRAFT' and (new.effective_from is distinct from old.effective_from
     or new.effective_to is distinct from old.effective_to
     or new.source_reference is distinct from old.source_reference) then
    raise exception 'RULE_SET_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  if old.approved_at is not null and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'RULE_SET_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

-- Entries are editable ONLY while the parent set is DRAFT.
create or replace function public.tg_legal_rule_entries_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_set uuid; v_status legal_rule_set_status;
begin
  v_set := case when tg_op = 'DELETE' then old.rule_set_id else new.rule_set_id end;
  select status into v_status from public.legal_rule_sets where id = v_set;
  if v_status is distinct from 'DRAFT' then
    raise exception 'RULE_SET_NOT_DRAFT' using errcode = '22000';
  end if;
  if tg_op = 'UPDATE' and new.rule_set_id is distinct from old.rule_set_id then
    raise exception 'RULE_SET_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

-- REDACTED audit. NEVER tg_audit(). Logs only whitelisted non-sensitive
-- columns (TG_ARGV[0], comma list) + changed FIELD NAMES.
create or replace function public.tg_payroll_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_keys text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
  v_old jsonb; v_new jsonb; v_src jsonb; v_id uuid; v_changed text[]; v_wl_old jsonb; v_wl_new jsonb;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new); v_src := v_new;
  elsif tg_op = 'UPDATE' then v_old := to_jsonb(old); v_new := to_jsonb(new); v_src := v_new;
  else v_old := to_jsonb(old); v_src := v_old; end if;
  v_id := (v_src ->> 'id')::uuid;

  if v_old is not null then
    select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb) into v_wl_old from unnest(v_keys) as k;
  end if;
  if v_new is not null then
    select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb) into v_wl_new from unnest(v_keys) as k;
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) as k
     where k <> 'updated_at' and (v_new -> k) is distinct from (v_old -> k);
    if v_changed is null then return new; end if;
    perform public.write_log(tg_table_name, v_id, 'UPDATED', v_wl_old,
      v_wl_new || jsonb_build_object('changed_fields', to_jsonb(v_changed)));
    return new;
  elsif tg_op = 'INSERT' then
    perform public.write_log(tg_table_name, v_id, 'CREATED', null, v_wl_new);
    return new;
  else
    perform public.write_log(tg_table_name, v_id, 'DELETED', v_wl_old, null);
    return old;
  end if;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['salary_components','salary_component_versions','compensation_profiles',
                           'personnel_payment_destinations','legal_rule_sets','legal_rule_entries']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s
                    for each row execute function public.tg_touch_updated_at();', t);
  end loop;
  foreach t in array array['salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','personnel_payment_destinations','legal_rule_sets']
  loop
    execute format('drop trigger if exists trg_no_delete_%1$s on public.%1$s;', t);
    execute format('create trigger trg_no_delete_%1$s before delete on public.%1$s
                    for each row execute function public.tg_payroll_no_delete();', t);
  end loop;
end $$;

drop trigger if exists trg_immutable_salary_component_versions on public.salary_component_versions;
create trigger trg_immutable_salary_component_versions before update on public.salary_component_versions
  for each row execute function public.tg_versioned_row_immutability();
drop trigger if exists trg_immutable_compensation_profiles on public.compensation_profiles;
create trigger trg_immutable_compensation_profiles before update on public.compensation_profiles
  for each row execute function public.tg_versioned_row_immutability();
drop trigger if exists trg_frozen_compensation_lines on public.compensation_lines;
create trigger trg_frozen_compensation_lines before update on public.compensation_lines
  for each row execute function public.tg_payroll_frozen();
drop trigger if exists trg_guard_salary_components on public.salary_components;
create trigger trg_guard_salary_components before update on public.salary_components
  for each row execute function public.tg_salary_components_guard();
drop trigger if exists trg_guard_personnel_payment_destinations on public.personnel_payment_destinations;
create trigger trg_guard_personnel_payment_destinations before update on public.personnel_payment_destinations
  for each row execute function public.tg_payment_destination_guard();
drop trigger if exists trg_guard_legal_rule_sets on public.legal_rule_sets;
create trigger trg_guard_legal_rule_sets before update on public.legal_rule_sets
  for each row execute function public.tg_legal_rule_sets_guard();
drop trigger if exists trg_guard_legal_rule_entries on public.legal_rule_entries;
create trigger trg_guard_legal_rule_entries before insert or update or delete on public.legal_rule_entries
  for each row execute function public.tg_legal_rule_entries_guard();

-- Redacted audit (whitelists contain NO amounts / rates / bank values / notes).
drop trigger if exists trg_payroll_audit_salary_components on public.salary_components;
create trigger trg_payroll_audit_salary_components after insert or update or delete on public.salary_components
  for each row execute function public.tg_payroll_audit('code,component_type,is_active');
drop trigger if exists trg_payroll_audit_salary_component_versions on public.salary_component_versions;
create trigger trg_payroll_audit_salary_component_versions after insert or update or delete on public.salary_component_versions
  for each row execute function public.tg_payroll_audit('component_id,version_number,calculation_method,effective_from,effective_to');
drop trigger if exists trg_payroll_audit_compensation_profiles on public.compensation_profiles;
create trigger trg_payroll_audit_compensation_profiles after insert or update or delete on public.compensation_profiles
  for each row execute function public.tg_payroll_audit('personnel_id,version_number,currency,payment_frequency,effective_from,effective_to');
drop trigger if exists trg_payroll_audit_personnel_payment_destinations on public.personnel_payment_destinations;
create trigger trg_payroll_audit_personnel_payment_destinations after insert or update or delete on public.personnel_payment_destinations
  for each row execute function public.tg_payroll_audit('personnel_id,is_primary,is_active');
drop trigger if exists trg_payroll_audit_legal_rule_sets on public.legal_rule_sets;
create trigger trg_payroll_audit_legal_rule_sets after insert or update or delete on public.legal_rule_sets
  for each row execute function public.tg_payroll_audit('name,jurisdiction,version_number,status,effective_from,effective_to');
drop trigger if exists trg_payroll_audit_legal_rule_entries on public.legal_rule_entries;
create trigger trg_payroll_audit_legal_rule_entries after insert or update or delete on public.legal_rule_entries
  for each row execute function public.tg_payroll_audit('rule_set_id,rule_key');

-- =====================================================================
-- ROLLBACK (reverse order; drops all Phase 2 config data)
-- drop table if exists public.legal_rule_set_transitions, public.legal_rule_entries, public.legal_rule_sets,
--   public.personnel_payment_destinations, public.compensation_lines, public.compensation_profiles,
--   public.salary_component_versions, public.salary_components cascade;
-- drop function if exists public.tg_payroll_audit(), public.tg_legal_rule_entries_guard(), public.tg_legal_rule_sets_guard(),
--   public.tg_payment_destination_guard(), public.tg_salary_components_guard(), public.tg_payroll_frozen(),
--   public.tg_versioned_row_immutability(), public.tg_payroll_no_delete();
-- drop type if exists legal_rule_set_status, salary_calculation_method, salary_component_type;
-- =====================================================================

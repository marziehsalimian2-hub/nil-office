-- =====================================================================
-- NIL Office — 0119_payroll_calc_tables.sql
-- HR & Payroll — Phase 3 — schema ONLY (periods, work data, batches,
-- calculation snapshots, warnings). Tables start empty; nothing legal is seeded
-- (only the 6 workflow rows of payroll_batch_transitions).
--
-- DATE SEMANTICS: payroll_periods.period_start AND period_end are BOTH INCLUSIVE
-- (a Jalali month's first and last day) — deliberately unlike the half-open
-- Phase 1-2 ranges; the engine converts when comparing to those.
--
-- ALL writes go through SECURITY DEFINER RPCs (0120/0121); no INSERT/UPDATE/
-- DELETE policy or grant exists (0123). Triggers here are the DB backstop.
-- Results/lines/warnings/calculations are IMMUTABLE and never deleted.
-- payroll_work_inputs rows may be deleted by the save RPC only (working data;
-- history = audit log (field names, no amounts) + the immutable result snapshot).
--
-- AUDIT: never tg_audit(). tg_payroll_audit whitelists exclude every amount,
-- hours field and free-text note. No audit trigger on the 4 result-side tables
-- (high volume): calculate_payroll_batch writes ONE log row with counts only.
-- batch.status is TEXT + CHECK (not an enum) so the next phase can extend it
-- by replacing ck_payroll_batches_status — no ALTER TYPE ADD VALUE needed.
-- =====================================================================

create table if not exists public.payroll_periods (
  id             uuid primary key default gen_random_uuid(),
  jalali_year    integer not null check (jalali_year between 1300 and 1500),
  jalali_month   integer not null check (jalali_month between 1 and 12),
  period_start   date not null,
  period_end     date not null,
  fiscal_year_id uuid references public.fiscal_years(id) on delete restrict,
  status         text not null default 'OPEN' check (status in ('OPEN','CLOSED')),   -- CLOSED reserved (no RPC yet)
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_payroll_period_month unique (jalali_year, jalali_month),
  constraint ck_payroll_period_dates check (period_end - period_start between 27 and 30)
);

create table if not exists public.payroll_batches (
  id                     uuid primary key default gen_random_uuid(),
  batch_number           text not null,
  year                   integer not null,
  sequence_number        integer not null,
  period_id              uuid not null references public.payroll_periods(id) on delete restrict,
  payroll_type           text not null default 'REGULAR' check (payroll_type in ('REGULAR')),
  currency               text not null check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  jurisdiction           text,
  rounding_scale         integer not null check (rounding_scale between 0 and 4),
  rounding_mode          text not null check (rounding_mode in ('HALF_UP','DOWN','UP')),
  status                 text not null default 'DRAFT',
  calculation_version    integer not null default 0 check (calculation_version >= 0),
  current_calculation_id uuid,
  calculated_by          uuid references public.profiles(id),
  calculated_at          timestamptz,
  submitted_by           uuid references public.profiles(id),
  submitted_at           timestamptz,
  reviewed_by            uuid references public.profiles(id),
  reviewed_at            timestamptz,
  cancelled_by           uuid references public.profiles(id),
  cancelled_at           timestamptz,
  status_note            text,
  notes                  text,
  created_by             uuid not null references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_payroll_batch_number unique (batch_number),
  constraint uq_payroll_batch_seq unique (year, sequence_number),
  constraint ck_payroll_batches_status check (status in ('DRAFT','CALCULATED','UNDER_REVIEW','CANCELLED')),
  constraint ck_payroll_batches_calc_ptr check (status = 'CANCELLED' or ((status = 'DRAFT') = (current_calculation_id is null))),
  constraint ck_payroll_batches_review_stamp check ((reviewed_by is null) = (reviewed_at is null)),
  constraint ck_payroll_batches_jurisdiction check (jurisdiction is null or length(btrim(jurisdiction)) > 0)
);
-- One live batch per (period, type, currency): duplicate final payroll is impossible by construction.
create unique index if not exists uq_payroll_batch_live on public.payroll_batches (period_id, payroll_type, currency) where status <> 'CANCELLED';
create index if not exists idx_payroll_batches_period on public.payroll_batches (period_id);

create table if not exists public.payroll_batch_transitions (
  from_status   text not null,
  to_status     text not null,
  required_tier text not null check (required_tier in ('CREATE','APPROVE')),
  primary key (from_status, to_status)
);
insert into public.payroll_batch_transitions (from_status, to_status, required_tier) values
  ('DRAFT','CALCULATED','CREATE'),         -- only via calculate_payroll_batch
  ('CALCULATED','UNDER_REVIEW','CREATE'),
  ('UNDER_REVIEW','CALCULATED','APPROVE'), -- send back (reason required)
  ('DRAFT','CANCELLED','CREATE'),
  ('CALCULATED','CANCELLED','APPROVE'),
  ('UNDER_REVIEW','CANCELLED','APPROVE')
on conflict do nothing;

-- Eligibility exceptions only (membership itself is derived at calculation time).
create table if not exists public.payroll_eligibility_overrides (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.payroll_batches(id) on delete restrict,
  personnel_id uuid not null references public.personnel(id) on delete restrict,
  decision    text not null check (decision in ('INCLUDE','EXCLUDE','AUTO')),   -- AUTO = override cleared
  reason      text,
  decided_by  uuid not null references public.profiles(id),
  decided_at  timestamptz not null default now(),
  constraint uq_payroll_override unique (batch_id, personnel_id),
  constraint ck_payroll_override_reason check (decision = 'AUTO' or length(btrim(coalesce(reason, ''))) > 0)
);

-- Monthly work data: per (period, personnel). Mutable working data; `revision`
-- is bumped on every save and snapshotted by calculations (staleness detection).
create table if not exists public.payroll_work_data (
  id               uuid primary key default gen_random_uuid(),
  period_id        uuid not null references public.payroll_periods(id) on delete restrict,
  personnel_id     uuid not null references public.personnel(id) on delete restrict,
  work_days        numeric(5,2) check (work_days is null or work_days between 0 and 31),
  work_hours       numeric(7,2) check (work_hours is null or work_hours between 0 and 744),
  overtime_hours   numeric(7,2) check (overtime_hours is null or overtime_hours between 0 and 744),
  absence_days     numeric(5,2) check (absence_days is null or absence_days between 0 and 31),
  absence_hours    numeric(7,2) check (absence_hours is null or absence_hours between 0 and 744),
  paid_leave_days  numeric(5,2) check (paid_leave_days is null or paid_leave_days between 0 and 31),
  unpaid_leave_days numeric(5,2) check (unpaid_leave_days is null or unpaid_leave_days between 0 and 31),
  mission_days     numeric(5,2) check (mission_days is null or mission_days between 0 and 31),
  mission_hours    numeric(7,2) check (mission_hours is null or mission_hours between 0 and 744),
  notes            text,
  source           text not null default 'MANUAL' check (source in ('MANUAL','PROJECT_WORKLOG','IMPORT','INTEGRATION','ADJUSTMENT')),
  revision         integer not null default 1,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  constraint uq_payroll_work_data unique (period_id, personnel_id)
);
create index if not exists idx_payroll_work_data_period on public.payroll_work_data (period_id);

-- Variable money inputs (bonus, commission, other) per MANUAL_INPUT component.
create table if not exists public.payroll_work_inputs (
  id           uuid primary key default gen_random_uuid(),
  work_data_id uuid not null references public.payroll_work_data(id) on delete restrict,
  component_id uuid not null references public.salary_components(id) on delete restrict,
  amount       numeric(20,4) not null check (amount >= 0),
  currency     text not null check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_payroll_work_input unique (work_data_id, component_id)
);

-- One row per calculate call. Immutable history; batch.current_calculation_id is the live one.
create table if not exists public.payroll_calculations (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.payroll_batches(id) on delete restrict,
  calculation_version integer not null,
  engine_version      text not null,
  currency            text not null,
  jurisdiction        text,
  rounding_scale      integer not null,
  rounding_mode       text not null,
  period_start        date not null,
  period_end          date not null,
  calculated_by       uuid not null references public.profiles(id),
  calculated_at       timestamptz not null default now(),
  constraint uq_payroll_calc_version unique (batch_id, calculation_version),
  constraint uq_payroll_calc_id_batch unique (id, batch_id)
);

do $$ begin
  alter table public.payroll_batches add constraint fk_payroll_batches_current_calc
    foreign key (current_calculation_id, id) references public.payroll_calculations (id, batch_id) on delete restrict;
exception when duplicate_object then null; end $$;

create table if not exists public.payroll_results (
  id                          uuid primary key default gen_random_uuid(),
  calculation_id              uuid not null,
  batch_id                    uuid not null,
  personnel_id                uuid not null references public.personnel(id) on delete restrict,
  personnel_number            text not null,   -- snapshots (payroll-gated table)
  personnel_name              text not null,
  compensation_profile_id     uuid references public.compensation_profiles(id) on delete restrict,   -- null = missing profile
  compensation_version_number integer,
  work_data_id                uuid references public.payroll_work_data(id) on delete restrict,
  work_data_revision          integer,
  currency                    text,
  gross                       numeric(20,4) not null default 0,
  total_deductions            numeric(20,4) not null default 0,
  employer_cost               numeric(20,4) not null default 0,
  net                         numeric(20,4) not null default 0,
  is_complete                 boolean not null,
  critical_count              integer not null default 0,
  warning_count               integer not null default 0,
  inputs                      jsonb not null default '{}'::jsonb,   -- NON-monetary snapshot (frequency, work-data numbers, override)
  created_at                  timestamptz not null default now(),
  constraint fk_payroll_results_calc foreign key (calculation_id, batch_id)
    references public.payroll_calculations (id, batch_id) on delete restrict,
  constraint uq_payroll_result unique (calculation_id, personnel_id),
  constraint ck_payroll_result_net check (net = gross - total_deductions)
);
create index if not exists idx_payroll_results_batch on public.payroll_results (batch_id);

-- Lines are inserted BEFORE their result row (totals are summed from them), hence the deferred FK.
create table if not exists public.payroll_result_lines (
  id                   uuid primary key default gen_random_uuid(),
  result_id            uuid not null references public.payroll_results(id) on delete restrict deferrable initially deferred,
  line_order           integer not null,
  component_id         uuid references public.salary_components(id) on delete restrict,             -- null = synthetic BASE_SALARY
  component_version_id uuid references public.salary_component_versions(id) on delete restrict,
  component_code       text not null,
  component_name_fa    text not null,
  component_type       salary_component_type not null,
  method               text not null check (method in ('PROFILE_BASE','FIXED','PERCENTAGE','MANUAL_INPUT','QUANTITY_X_RATE','FORMULA')),
  status               text not null check (status in ('COMPUTED','NOT_COMPUTED')),
  amount               numeric(20,4),
  amount_source        text check (amount_source in ('PROFILE','COMPONENT_DEFAULT','COMPENSATION_OVERRIDE','MANUAL_INPUT','RULE')),
  basis                text,
  base_amount          numeric(20,4),
  rate                 numeric(20,6),
  rate_source          text check (rate_source in ('COMPONENT','COMPENSATION_OVERRIDE','RULE')),
  rule_key             text,
  rule_set_id          uuid references public.legal_rule_sets(id) on delete restrict,
  rule_entry_id        uuid references public.legal_rule_entries(id) on delete restrict,
  taxable              boolean not null default false,
  insurable            boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint ck_payroll_line_amount check ((status = 'COMPUTED') = (amount is not null)),
  constraint uq_payroll_line_order unique (result_id, line_order)
);

create table if not exists public.payroll_calc_warnings (
  id             uuid primary key default gen_random_uuid(),
  calculation_id uuid not null,
  batch_id       uuid not null,
  personnel_id   uuid references public.personnel(id) on delete restrict,   -- null = batch-level
  severity       text not null check (severity in ('CRITICAL','WARNING','INFO')),
  code           text not null check (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  component_code text,    -- codes/keys only: never amounts or bank values
  rule_key       text,
  created_at     timestamptz not null default now(),
  constraint fk_payroll_warnings_calc foreign key (calculation_id, batch_id)
    references public.payroll_calculations (id, batch_id) on delete restrict
);
create index if not exists idx_payroll_warnings_calc on public.payroll_calc_warnings (calculation_id, personnel_id);

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function public.tg_payroll_periods_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_payroll_batches_guard() returns trigger language plpgsql as $$
declare
  v_mut text[] := array['status','jurisdiction','rounding_scale','rounding_mode','calculation_version','current_calculation_id',
    'calculated_by','calculated_at','submitted_by','submitted_at','reviewed_by','reviewed_at','cancelled_by','cancelled_at',
    'status_note','notes','updated_at'];
begin
  if old.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if (to_jsonb(new) - v_mut) is distinct from (to_jsonb(old) - v_mut) then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  if new.status is distinct from old.status and not exists (
       select 1 from public.payroll_batch_transitions t where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;
  if old.status = 'UNDER_REVIEW' and new.status = 'UNDER_REVIEW'
     and (new.jurisdiction is distinct from old.jurisdiction or new.rounding_scale <> old.rounding_scale or new.rounding_mode <> old.rounding_mode) then
    raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '22000';
  end if;
  if new.calculation_version < old.calculation_version then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_payroll_work_data_guard() returns trigger language plpgsql as $$
begin
  if new.period_id is distinct from old.period_id or new.personnel_id is distinct from old.personnel_id
     or new.created_by is distinct from old.created_by or new.revision <> old.revision + 1 then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_payroll_work_inputs_guard() returns trigger language plpgsql as $$
begin
  if new.work_data_id is distinct from old.work_data_id or new.component_id is distinct from old.component_id then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

create or replace function public.tg_payroll_overrides_guard() returns trigger language plpgsql as $$
begin
  if new.batch_id is distinct from old.batch_id or new.personnel_id is distinct from old.personnel_id then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['payroll_periods','payroll_batches','payroll_work_data','payroll_work_inputs']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.tg_touch_updated_at();', t);
  end loop;
  foreach t in array array['payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_calculations','payroll_results','payroll_result_lines','payroll_calc_warnings']
  loop
    execute format('drop trigger if exists trg_no_delete_%1$s on public.%1$s;', t);
    execute format('create trigger trg_no_delete_%1$s before delete on public.%1$s for each row execute function public.tg_payroll_no_delete();', t);
  end loop;
  foreach t in array array['payroll_calculations','payroll_results','payroll_result_lines','payroll_calc_warnings']
  loop
    execute format('drop trigger if exists trg_frozen_%1$s on public.%1$s;', t);
    execute format('create trigger trg_frozen_%1$s before update on public.%1$s for each row execute function public.tg_payroll_frozen();', t);
  end loop;
end $$;

drop trigger if exists trg_guard_payroll_periods on public.payroll_periods;
create trigger trg_guard_payroll_periods before update on public.payroll_periods for each row execute function public.tg_payroll_periods_guard();
drop trigger if exists trg_guard_payroll_batches on public.payroll_batches;
create trigger trg_guard_payroll_batches before update on public.payroll_batches for each row execute function public.tg_payroll_batches_guard();
drop trigger if exists trg_guard_payroll_work_data on public.payroll_work_data;
create trigger trg_guard_payroll_work_data before update on public.payroll_work_data for each row execute function public.tg_payroll_work_data_guard();
drop trigger if exists trg_guard_payroll_work_inputs on public.payroll_work_inputs;
create trigger trg_guard_payroll_work_inputs before update on public.payroll_work_inputs for each row execute function public.tg_payroll_work_inputs_guard();
drop trigger if exists trg_guard_payroll_overrides on public.payroll_eligibility_overrides;
create trigger trg_guard_payroll_overrides before update on public.payroll_eligibility_overrides for each row execute function public.tg_payroll_overrides_guard();

-- Redacted audit (whitelists: no amounts, hours, notes, reasons).
drop trigger if exists trg_payroll_audit_payroll_periods on public.payroll_periods;
create trigger trg_payroll_audit_payroll_periods after insert or update or delete on public.payroll_periods
  for each row execute function public.tg_payroll_audit('jalali_year,jalali_month,period_start,period_end,status');
drop trigger if exists trg_payroll_audit_payroll_batches on public.payroll_batches;
create trigger trg_payroll_audit_payroll_batches after insert or update or delete on public.payroll_batches
  for each row execute function public.tg_payroll_audit('batch_number,period_id,payroll_type,currency,jurisdiction,rounding_scale,rounding_mode,status,calculation_version');
drop trigger if exists trg_payroll_audit_payroll_work_data on public.payroll_work_data;
create trigger trg_payroll_audit_payroll_work_data after insert or update or delete on public.payroll_work_data
  for each row execute function public.tg_payroll_audit('period_id,personnel_id,revision,source');
drop trigger if exists trg_payroll_audit_payroll_work_inputs on public.payroll_work_inputs;
create trigger trg_payroll_audit_payroll_work_inputs after insert or update or delete on public.payroll_work_inputs
  for each row execute function public.tg_payroll_audit('work_data_id,component_id,currency');
drop trigger if exists trg_payroll_audit_payroll_eligibility_overrides on public.payroll_eligibility_overrides;
create trigger trg_payroll_audit_payroll_eligibility_overrides after insert or update or delete on public.payroll_eligibility_overrides
  for each row execute function public.tg_payroll_audit('batch_id,personnel_id,decision');

-- =====================================================================
-- ROLLBACK (drops all Phase 3 data)
-- drop table if exists public.payroll_calc_warnings, public.payroll_result_lines, public.payroll_results cascade;
-- alter table public.payroll_batches drop constraint if exists fk_payroll_batches_current_calc;
-- drop table if exists public.payroll_calculations, public.payroll_work_inputs, public.payroll_work_data,
--   public.payroll_eligibility_overrides, public.payroll_batch_transitions, public.payroll_batches, public.payroll_periods cascade;
-- drop function if exists public.tg_payroll_overrides_guard(), public.tg_payroll_work_inputs_guard(),
--   public.tg_payroll_work_data_guard(), public.tg_payroll_batches_guard(), public.tg_payroll_periods_guard();
-- =====================================================================

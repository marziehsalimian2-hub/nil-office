-- =====================================================================
-- NIL Office — 0110_personnel_tables.sql
-- Human Resources & Payroll — Phase 1 (Personnel + Employment only) —
-- core schema. No compensation/payroll/money anywhere in this file —
-- that is explicitly out of scope until a later phase (Compensation
-- Profile, Salary Component Engine, Payroll Period/Batch, Payslip, ...).
--
-- Decoupled from profiles/auth.users on purpose (spec §3): a Personnel
-- row represents a person NIL employs, who may or may not ever get a
-- NIL Office login. profile_id is nullable and ON DELETE SET NULL —
-- unlike every other domain's created_by/performed_by columns, which
-- hang off profiles(id) with a hard "a profile cannot disappear out
-- from under a business row" expectation, a Personnel row must survive
-- its linked login account being removed (spec §11: nothing about a
-- person's employment history is ever deleted).
--
-- NOTE for future readers: this is UNRELATED to accounting's existing
-- detail_kind enum, which already has an 'EMPLOYEE' value (0007) — that
-- is Accounting's own sub-ledger "detail account" categorization
-- (customer/supplier/employee/shareholder), not a person record. Do not
-- conflate the two; a Personnel row and an EMPLOYEE-kind detail_account
-- are not currently linked and Phase 1 does not link them.
--
-- Personnel carries a DENORMALIZED CURRENT snapshot of employment_type/
-- job_title/department/manager_personnel_id (cheap listing/search,
-- always in sync with the currently-open employment_records row) —
-- employment_records is the append-only, authoritative history. The
-- snapshot is written exclusively by onboard_personnel()/
-- create_employment_record() (0111); nothing else may touch those four
-- columns directly (enforced in 0112's RLS via the same
-- self-comparison-subquery idiom p_profiles_update_self already uses).
--
-- Naming convention for the versioned Employment Record: start_date/
-- end_date, "currently active row" = end_date is null — same shape as
-- service_arrangements.started_at/ended_at (0084_service_ledger_tables.sql),
-- the closest existing precedent for a dated sub-record off a parent
-- entity, chosen over "effective_to" for consistency with the spec's
-- own field names (start_date/end_date) and with hire_date/
-- termination_date already used on Personnel itself.
-- =====================================================================

do $$ begin
  create type personnel_status as enum ('ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED','ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type personnel_employment_type as enum
    ('FULL_TIME','PART_TIME','CONTRACT','CONSULTANT','TEMPORARY','INTERN','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_record_status as enum ('ACTIVE','ENDED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- personnel — one row per person NIL employs.
-- ---------------------------------------------------------------------
create table if not exists public.personnel (
  id                    uuid primary key default gen_random_uuid(),

  personnel_number      text not null,         -- EMP-1405-0001, trigger-issued
  sequence_number       int not null,
  year                  int not null,

  profile_id            uuid references public.profiles(id) on delete set null,

  first_name            text not null,
  last_name             text not null,
  mobile                text,
  email                 text,
  address               text,

  employment_status     personnel_status not null default 'ACTIVE',
  hire_date             date not null,
  termination_date      date,

  -- Denormalized CURRENT snapshot — see header comment. Kept in sync by
  -- onboard_personnel()/create_employment_record() only (0111); direct
  -- writes to these four columns are blocked in 0112's RLS.
  job_title              text not null,
  department             text,
  manager_personnel_id   uuid references public.personnel(id) on delete set null,
  employment_type        personnel_employment_type not null,

  work_location          text,
  notes                  text,

  created_by             uuid not null references public.profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint uq_personnel_number unique (personnel_number),
  constraint ck_personnel_termination_requires_date
    check (employment_status <> 'TERMINATED' or termination_date is not null),
  constraint ck_personnel_no_self_manager check (manager_personnel_id is distinct from id)
);

create unique index if not exists uq_personnel_seq on public.personnel (year, sequence_number);
create index if not exists idx_personnel_status on public.personnel (employment_status);
create index if not exists idx_personnel_manager on public.personnel (manager_personnel_id);
create index if not exists idx_personnel_profile on public.personnel (profile_id);
create index if not exists idx_personnel_name on public.personnel using gin ((first_name || ' ' || last_name) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- employment_records — versioned employment history. The row with
-- end_date is null is the CURRENT tenure; every prior change is a real,
-- immutable row — never rewritten in place (spec §4).
-- ---------------------------------------------------------------------
create table if not exists public.employment_records (
  id                              uuid primary key default gen_random_uuid(),
  personnel_id                    uuid not null references public.personnel(id) on delete cascade,

  employment_type                 personnel_employment_type not null,
  job_title                       text not null,
  department                      text,
  manager_personnel_id            uuid references public.personnel(id) on delete set null,

  start_date                      date not null,
  end_date                        date,   -- null = current; set = first day the NEXT record applies (half-open [start_date, end_date))

  work_schedule_type              text,   -- free text (spec gives no closed vocabulary for this field)
  standard_monthly_hours          numeric(6,2) check (standard_monthly_hours is null or standard_monthly_hours >= 0),
  standard_weekly_hours           numeric(6,2) check (standard_weekly_hours is null or standard_weekly_hours >= 0),

  status                          employment_record_status not null default 'ACTIVE',
  employment_contract_document_id uuid references public.attachments(id) on delete set null,

  created_by                      uuid not null references public.profiles(id),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  constraint ck_employment_records_dates check (end_date is null or end_date >= start_date),
  constraint ck_employment_records_no_self_manager check (manager_personnel_id is distinct from personnel_id)
);

create index if not exists idx_employment_records_personnel on public.employment_records (personnel_id);
create unique index if not exists uq_employment_records_one_open
  on public.employment_records (personnel_id) where end_date is null;
create index if not exists idx_employment_records_manager on public.employment_records (manager_personnel_id);

-- ---------------------------------------------------------------------
-- personnel_sensitive_details — confidentiality SPLIT table: this app
-- has one shared "authenticated" Postgres role, so per-tier column
-- visibility can only be achieved via RLS on a SEPARATE table, never a
-- plain column on personnel — mirrors time_entry_internal_costs/
-- internal_cost_rates (0084/0086_service_ledger). RLS (0112) restricts
-- every operation to can_view_hr_sensitive() (ADMIN tier of hr_role) —
-- see 0107's header comment for the justification.
-- ---------------------------------------------------------------------
create table if not exists public.personnel_sensitive_details (
  personnel_id       uuid primary key references public.personnel(id) on delete cascade,
  national_id        text,
  passport_number    text,
  birth_date         date,
  emergency_contact  text,
  updated_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- personnel_status_transitions — reference data only (looked up, never
-- written to, by change_personnel_status(), 0111) — same shape as
-- cheque_status_transitions (0075): a CHECK constraint can't see the
-- OLD row, and a generic trigger would duplicate the per-transition
-- role-gating/audit the RPC already does, so this stays a plain lookup
-- table.
-- ---------------------------------------------------------------------
create table if not exists public.personnel_status_transitions (
  from_status personnel_status not null,
  to_status   personnel_status not null,
  primary key (from_status, to_status)
);

insert into public.personnel_status_transitions (from_status, to_status) values
  ('ACTIVE','ON_LEAVE'), ('ACTIVE','SUSPENDED'), ('ACTIVE','TERMINATED'),
  ('ON_LEAVE','ACTIVE'), ('ON_LEAVE','SUSPENDED'), ('ON_LEAVE','TERMINATED'),
  ('SUSPENDED','ACTIVE'), ('SUSPENDED','TERMINATED'),
  ('TERMINATED','ARCHIVED'),
  ('TERMINATED','ACTIVE')   -- rehire: ADMIN-tier-only + requires new employment details, enforced in change_personnel_status() (0111), not here
on conflict do nothing;

-- ---------------------------------------------------------------------
-- touch/audit triggers — mirrors 0075_cheque_tables.sql. write_log()
-- based audit (0003) satisfies "every Personnel/Employment write goes
-- through write_log()" for plain inserts/updates/deletes;
-- change_personnel_status()/create_employment_record() (0111) ALSO
-- write their own richer semantic log entries (STATUS_CHANGED /
-- EMPLOYMENT_RECORD_CREATED) in addition to the generic UPDATE one this
-- loop produces — same double-logging pattern post_receipt/post_payment
-- already use.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['personnel','employment_records','personnel_sensitive_details']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- tg_employment_records_immutability — "no silent modification" for
-- history rows (mirrors tg_cheques_immutability, 0075): once a record
-- is CLOSED (end_date already set), nothing about it may ever change
-- again, via ANY path. While a record is still OPEN (end_date is null —
-- the current tenure), only end_date/status/employment_contract_
-- document_id may change (closing it out, or attaching the signed
-- contract file after the record was created); job_title/department/
-- employment_type/manager_personnel_id/start_date/work_schedule_type/
-- standard_*_hours are immutable from the moment the row is inserted —
-- corrections go through create_employment_record() + a new row, never
-- an edit of an existing one.
-- ---------------------------------------------------------------------
create or replace function public.tg_employment_records_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.end_date is not null then
    raise exception 'EMPLOYMENT_RECORD_CLOSED_IMMUTABLE' using errcode = '22000';
  end if;

  if new.employment_type          is distinct from old.employment_type
     or new.job_title              is distinct from old.job_title
     or new.department             is distinct from old.department
     or new.manager_personnel_id   is distinct from old.manager_personnel_id
     or new.start_date             is distinct from old.start_date
     or new.work_schedule_type     is distinct from old.work_schedule_type
     or new.standard_monthly_hours is distinct from old.standard_monthly_hours
     or new.standard_weekly_hours  is distinct from old.standard_weekly_hours
     or new.personnel_id           is distinct from old.personnel_id
  then
    raise exception 'EMPLOYMENT_RECORD_FIELD_IMMUTABLE' using errcode = '22000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_employment_records_immutability on public.employment_records;
create trigger trg_employment_records_immutability
  before update on public.employment_records
  for each row execute function public.tg_employment_records_immutability();

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop trigger if exists trg_employment_records_immutability on public.employment_records;
-- drop function if exists public.tg_employment_records_immutability();
-- drop trigger if exists trg_audit_personnel_sensitive_details on public.personnel_sensitive_details;
-- drop trigger if exists trg_touch_personnel_sensitive_details on public.personnel_sensitive_details;
-- drop trigger if exists trg_audit_employment_records on public.employment_records;
-- drop trigger if exists trg_touch_employment_records on public.employment_records;
-- drop trigger if exists trg_audit_personnel on public.personnel;
-- drop trigger if exists trg_touch_personnel on public.personnel;
-- drop table if exists public.personnel_status_transitions;
-- drop table if exists public.personnel_sensitive_details;
-- drop table if exists public.employment_records;
-- drop table if exists public.personnel;
-- drop type if exists employment_record_status;
-- drop type if exists personnel_employment_type;
-- drop type if exists personnel_status;
-- =====================================================================

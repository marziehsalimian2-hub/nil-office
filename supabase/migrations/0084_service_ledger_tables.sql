-- =====================================================================
-- NIL Office — 0084_service_ledger_tables.sql
-- Client Service Ledger — Phase 1 schema.
--
-- Scope (Phase 1 only, per the approved plan): Client Service File,
-- Service Arrangement, Service Entry, Service Categories, Time Entries,
-- Expenses, and the confidential internal-cost split table. Billing
-- batches, invoice conversion, and the PDF report builder are Phase 2+
-- — nothing here blocks adding them later as plain forward migrations.
--
-- billing_status is defined with its FULL 8-value spec vocabulary now
-- (forward-compatible), but service_entries/expenses each get a CHECK
-- restricting them to the 4 values reachable without a billing batch —
-- see ck_service_entries_billing_status_phase1 / ck_expenses_billing_status_phase1
-- below. No code path in Phase 1 can ever write INVOICED/PARTIALLY_SETTLED/
-- SETTLED/WAIVED; Phase 2 will replace these CHECKs with a real
-- adjacency-guard trigger once the billing-batch RPC exists.
-- =====================================================================

do $$ begin
  create type client_service_status as enum ('ACTIVE','ON_HOLD','CLOSED','ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_arrangement_type as enum
    ('RETAINER','FIXED_FEE','HOURLY','PER_SERVICE','PROJECT_BASED','CONTRACT_INCLUDED','CUSTOM');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_arrangement_status as enum ('DRAFT','ACTIVE','SUSPENDED','COMPLETED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_cycle as enum ('MONTHLY','QUARTERLY','ANNUAL','ONE_TIME');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_entry_status as enum ('DRAFT','IN_PROGRESS','COMPLETED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_status as enum
    ('NON_BILLABLE','INCLUDED','BILLABLE','READY_TO_BILL','INVOICED','PARTIALLY_SETTLED','SETTLED','WAIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type expense_paid_by as enum ('NIL','CLIENT','EMPLOYEE','OTHER');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- service_categories — ADMIN-extensible lookup (spec §6: not hard-coded),
-- mirrors contract_types (0021_contract_tables.sql) exactly. Shared by
-- both service_entries and expenses (Phase 1 pragmatic simplification —
-- see the plan's open decision #6).
-- ---------------------------------------------------------------------
create table if not exists public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_categories (code, name) values
  ('CONSULTING',          'مشاوره'),
  ('ADMINISTRATIVE',      'اداری'),
  ('CORRESPONDENCE',      'مکاتبات'),
  ('REGISTRATION',        'ثبتی'),
  ('LEGAL_COORDINATION',  'هماهنگی حقوقی'),
  ('TRADE',               'بازرگانی'),
  ('SOURCING',            'تأمین منابع'),
  ('NEGOTIATION',         'مذاکره'),
  ('MEETING',             'جلسه'),
  ('FOLLOW_UP',           'پیگیری'),
  ('RESEARCH',            'تحقیق'),
  ('ANALYSIS',            'تحلیل'),
  ('PROGRAMMING',         'برنامه‌نویسی'),
  ('DESIGN',              'طراحی'),
  ('DOCUMENT_PREPARATION','تهیهٔ مستندات'),
  ('FINANCIAL',           'مالی'),
  ('OTHER',               'سایر')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- client_service_files — one per company; the ongoing service
-- relationship record (not a legal document, no numbering/finalize).
-- ---------------------------------------------------------------------
create table if not exists public.client_service_files (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null unique references public.companies(id),
  status              client_service_status not null default 'ACTIVE',
  relationship_manager uuid references public.profiles(id) on delete set null,
  default_currency    text not null default 'IRR'
                        check (default_currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  notes               text,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_client_service_files_status on public.client_service_files (status);
create index if not exists idx_client_service_files_manager on public.client_service_files (relationship_manager);

-- ---------------------------------------------------------------------
-- service_arrangements — how services are provided to a client. Not
-- necessarily a legal contract (spec §4).
-- ---------------------------------------------------------------------
create table if not exists public.service_arrangements (
  id                     uuid primary key default gen_random_uuid(),
  client_service_file_id uuid not null references public.client_service_files(id) on delete cascade,
  title                  text not null,
  arrangement_type       service_arrangement_type not null,
  contract_id            uuid references public.contracts(id) on delete set null,
  project_id             uuid references public.projects(id) on delete set null,
  currency               text not null default 'IRR'
                           check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  fixed_fee              numeric(20,4) check (fixed_fee is null or fixed_fee >= 0),
  hourly_rate            numeric(20,4) check (hourly_rate is null or hourly_rate >= 0),
  billing_cycle          billing_cycle,
  included_hours         numeric(10,2) check (included_hours is null or included_hours >= 0),
  included_services_description text,
  status                 service_arrangement_status not null default 'DRAFT',
  started_at             date,
  ended_at               date,
  notes                  text,
  created_by             uuid not null references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ck_service_arrangements_dates check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists idx_service_arrangements_file on public.service_arrangements (client_service_file_id);
create index if not exists idx_service_arrangements_contract on public.service_arrangements (contract_id);
create index if not exists idx_service_arrangements_project on public.service_arrangements (project_id);
create index if not exists idx_service_arrangements_status on public.service_arrangements (status);

-- ---------------------------------------------------------------------
-- service_entries — the operational core: one row per unit of work
-- performed for a client.
-- ---------------------------------------------------------------------
create table if not exists public.service_entries (
  id                     uuid primary key default gen_random_uuid(),
  client_service_file_id uuid not null references public.client_service_files(id) on delete cascade,
  service_arrangement_id uuid references public.service_arrangements(id) on delete set null,
  contract_id            uuid references public.contracts(id) on delete set null,
  project_id             uuid references public.projects(id) on delete set null,
  task_id                uuid references public.tasks(id) on delete set null,
  crm_activity_id        uuid references public.crm_activities(id) on delete set null,

  service_date           date not null,
  service_category_id    uuid not null references public.service_categories(id),
  title                  text not null,
  description            text,
  performed_by           uuid not null references public.profiles(id),

  status                 service_entry_status not null default 'DRAFT',
  billing_status         billing_status not null default 'NON_BILLABLE',
  billing_method         text,
  currency               text not null default 'IRR'
                           check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  service_fee            numeric(20,4) not null default 0 check (service_fee >= 0),
  is_billable            boolean not null default true,
  notes                  text,

  created_by             uuid not null references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ck_service_entries_billing_status_phase1
    check (billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE','READY_TO_BILL'))
);

create index if not exists idx_service_entries_file on public.service_entries (client_service_file_id);
create index if not exists idx_service_entries_arrangement on public.service_entries (service_arrangement_id);
create index if not exists idx_service_entries_contract on public.service_entries (contract_id);
create index if not exists idx_service_entries_project on public.service_entries (project_id);
create index if not exists idx_service_entries_task on public.service_entries (task_id);
create index if not exists idx_service_entries_crm_activity on public.service_entries (crm_activity_id);
create index if not exists idx_service_entries_performed_by on public.service_entries (performed_by);
create index if not exists idx_service_entries_status on public.service_entries (status);
create index if not exists idx_service_entries_billing_status on public.service_entries (billing_status);
create index if not exists idx_service_entries_date on public.service_entries (service_date);

-- ---------------------------------------------------------------------
-- time_entries — child of service_entries. hourly_rate_snapshot is the
-- client-facing billing rate (NOT confidential — stays here).
-- ---------------------------------------------------------------------
create table if not exists public.time_entries (
  id                  uuid primary key default gen_random_uuid(),
  service_entry_id    uuid not null references public.service_entries(id) on delete cascade,
  performed_by        uuid not null references public.profiles(id),
  work_date           date not null,
  started_at          timestamptz,
  ended_at            timestamptz,
  duration_minutes    integer not null check (duration_minutes > 0),
  description         text,
  billable            boolean not null default true,
  hourly_rate_snapshot numeric(20,4) check (hourly_rate_snapshot is null or hourly_rate_snapshot >= 0),
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_time_entries_service_entry on public.time_entries (service_entry_id);
create index if not exists idx_time_entries_performed_by on public.time_entries (performed_by);
create index if not exists idx_time_entries_work_date on public.time_entries (work_date);

-- ---------------------------------------------------------------------
-- internal_cost_rates — lean v1 current-rate table (no history yet).
-- Confidential: RLS-gated in 0086 to ADMIN-tier only.
-- ---------------------------------------------------------------------
create table if not exists public.internal_cost_rates (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  hourly_cost_rate numeric(20,4) not null check (hourly_cost_rate >= 0),
  currency         text not null default 'IRR'
                     check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  updated_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- time_entry_internal_costs — the confidentiality SPLIT table (plan
-- decision #2): this app has one shared "authenticated" Postgres role,
-- so per-user column visibility can only be achieved via RLS on a
-- SEPARATE table, never a plain column on time_entries. Written once by
-- the server action alongside the time_entries insert; never updated
-- again afterwards (no updated_at — see tg_time_entry_cost_immutable
-- in 0085, which also enforces this at the DB level).
-- ---------------------------------------------------------------------
create table if not exists public.time_entry_internal_costs (
  time_entry_id             uuid primary key references public.time_entries(id) on delete cascade,
  internal_cost_rate_snapshot numeric(20,4) check (internal_cost_rate_snapshot is null or internal_cost_rate_snapshot >= 0),
  internal_cost_amount       numeric(20,4) check (internal_cost_amount is null or internal_cost_amount >= 0),
  created_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- expenses — child of service_entries.
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  service_entry_id    uuid not null references public.service_entries(id) on delete cascade,
  expense_date        date not null,
  category_id         uuid references public.service_categories(id),
  description         text not null,
  amount              numeric(20,4) not null check (amount > 0),
  currency            text not null default 'IRR'
                        check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  paid_by             expense_paid_by not null default 'NIL',
  payment_id          uuid references public.payments(id) on delete set null,
  accounting_reference text,
  is_reimbursable     boolean not null default false,
  reimbursable_amount numeric(20,4) check (reimbursable_amount is null or reimbursable_amount >= 0),
  billing_status      billing_status not null default 'NON_BILLABLE',
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ck_expenses_billing_status_phase1
    check (billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE','READY_TO_BILL'))
);

create index if not exists idx_expenses_service_entry on public.expenses (service_entry_id);
create index if not exists idx_expenses_payment on public.expenses (payment_id);
create index if not exists idx_expenses_billing_status on public.expenses (billing_status);

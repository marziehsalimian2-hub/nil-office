-- =====================================================================
-- NIL Office — 0050_project_tables.sql
-- Project & Task Management Phase 1 — schema for projects, phases,
-- milestones, and team membership.
--
-- Numbering: unlike CRM opportunities (numbered at creation), a
-- project has an explicit DRAFT status, so it follows the
-- contracts/invoices deferred-numbering pattern instead —
-- sequence_number/display_number/year stay null until
-- finalize_project() (0052) fires on DRAFT -> PLANNED. The
-- numberless-while-DRAFT-or-CANCELLED-before-numbering CHECK mirrors
-- contracts (0021_contract_tables.sql), including the CANCELLED fix
-- 0025_contract_cancel_check_fix.sql had to add after the fact —
-- included here from the start.
--
-- project_milestones has NO contract_payment_milestone_id — that
-- module doesn't exist (see this phase's plan notes; same resolution
-- Invoice Phase 1 used for the identical gap, 0030_sales_document_tables.sql).
-- =====================================================================

do $$ begin
  create type project_type as enum
    ('SOFTWARE','CONSULTING','SERVICE','INTERNAL','TRADE','RESEARCH','IMPLEMENTATION','SUPPORT','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum
    ('DRAFT','PLANNED','ACTIVE','ON_HOLD','COMPLETED','CANCELLED','ARCHIVED');
exception when duplicate_object then null; end $$;

-- Shared within this module only (projects/project_milestones/tasks) —
-- unlike crm_opportunity_priority, which is a different module's own
-- concept even though the values happen to match.
do $$ begin
  create type pm_priority as enum ('LOW','NORMAL','HIGH','URGENT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type phase_status as enum ('NOT_STARTED','IN_PROGRESS','COMPLETED','CANCELLED');
exception when duplicate_object then null; end $$;

-- No OVERDUE value: derived at query time from due_date, never stored
-- (spec explicitly forbids requiring a manual OVERDUE set for tasks —
-- applied the same way here for consistency across the module).
do $$ begin
  create type project_milestone_status as enum ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- projects — header.
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id                  uuid primary key default gen_random_uuid(),

  sequence_number     integer,             -- null until finalized (PLANNED)
  display_number      text,                -- null until finalized
  year                integer,             -- Jalali numbering year

  title               text not null,
  description         text,
  project_type        project_type not null default 'OTHER',

  company_id          uuid references public.companies(id) on delete set null,
  case_id             uuid references public.cases(id) on delete set null,
  crm_opportunity_id  uuid references public.crm_opportunities(id) on delete set null,
  contract_id         uuid references public.contracts(id) on delete set null,

  project_manager_id  uuid not null references public.profiles(id),
  owner_user_id       uuid references public.profiles(id) on delete set null,

  status              project_status not null default 'DRAFT',
  priority            pm_priority not null default 'NORMAL',

  planned_start_date  date,
  planned_end_date    date,
  actual_start_date   date,
  actual_end_date     date,

  progress_percent    smallint not null default 0 check (progress_percent between 0 and 100),

  budget_amount       numeric(20,4),
  budget_currency     text
    check (budget_currency is null or budget_currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),

  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,

  -- Numberless while DRAFT (or cancelled before ever being planned);
  -- complete once numbered, for any status thereafter.
  constraint ck_project_number_completeness check (
    (status in ('DRAFT','CANCELLED') and sequence_number is null)
    or (sequence_number is not null and display_number is not null and year is not null)
  )
);

-- A Won Opportunity may spawn at most one Project (spec §7) — a
-- Contract has no such limit (a contract may reasonably spawn several
-- projects, spec doesn't restrict this).
create unique index if not exists uq_projects_opportunity
  on public.projects (crm_opportunity_id) where crm_opportunity_id is not null;

create unique index if not exists uq_projects_seq
  on public.projects (year, sequence_number) where sequence_number is not null;
create unique index if not exists uq_projects_display
  on public.projects (display_number) where display_number is not null;

create index if not exists idx_projects_status    on public.projects (status);
create index if not exists idx_projects_company   on public.projects (company_id);
create index if not exists idx_projects_manager   on public.projects (project_manager_id);
create index if not exists idx_projects_owner     on public.projects (owner_user_id);
create index if not exists idx_projects_contract  on public.projects (contract_id);

-- ---------------------------------------------------------------------
-- project_phases.
-- ---------------------------------------------------------------------
create table if not exists public.project_phases (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,

  name                text not null,
  description         text,
  sequence            integer not null default 0,

  status              phase_status not null default 'NOT_STARTED',

  planned_start_date  date,
  planned_end_date    date,
  actual_start_date   date,
  actual_end_date     date,

  progress_percent    smallint not null default 0 check (progress_percent between 0 and 100),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_project_phases_project on public.project_phases (project_id, sequence);

-- ---------------------------------------------------------------------
-- project_milestones.
-- ---------------------------------------------------------------------
create table if not exists public.project_milestones (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  phase_id            uuid references public.project_phases(id) on delete set null,

  title               text not null,
  description         text,

  due_date            date,
  completed_at        timestamptz,

  status              project_milestone_status not null default 'PLANNED',
  priority            pm_priority not null default 'NORMAL',

  responsible_user_id uuid references public.profiles(id) on delete set null,

  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_project_milestones_project on public.project_milestones (project_id);
create index if not exists idx_project_milestones_phase   on public.project_milestones (phase_id);

-- ---------------------------------------------------------------------
-- project_members — team.
-- ---------------------------------------------------------------------
do $$ begin
  create type project_member_role as enum ('PROJECT_MANAGER','MEMBER','REVIEWER','OBSERVER');
exception when duplicate_object then null; end $$;

create table if not exists public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        project_member_role not null default 'MEMBER',
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,

  unique (project_id, user_id)
);

create index if not exists idx_project_members_project on public.project_members (project_id);
create index if not exists idx_project_members_user    on public.project_members (user_id);

-- ---------------------------------------------------------------------
-- number_sequences — add the PROJECT scope.
-- ---------------------------------------------------------------------
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT'));

-- =====================================================================
-- NIL Office — 0021_contract_tables.sql
-- Contract Management module — Phase 1 schema.
--
-- Scope (Phase 1 only): a single `contracts` core entity plus an
-- ADMIN-extensible `contract_types` lookup. Obligations, payment
-- milestones, amendments, and guarantees are deferred to Phase 2 —
-- nothing here blocks adding them later as plain forward migrations.
--
-- `kind` (NIL_ISSUED | HISTORICAL) distinguishes contracts NIL numbers
-- itself from ones imported with their own pre-existing number, in the
-- same table — mirroring how `correspondence.direction` handles
-- OUTGOING/INCOMING in one table rather than two.
-- =====================================================================

do $$ begin
  create type contract_status as enum
    ('DRAFT','UNDER_REVIEW','APPROVED','ACTIVE','SUSPENDED','COMPLETED','EXPIRED','TERMINATED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contract_kind as enum ('NIL_ISSUED','HISTORICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contract_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists contract_role contract_role;

-- ---------------------------------------------------------------------
-- contract_types — ADMIN-extensible lookup (spec §3: not hard-coded).
-- ---------------------------------------------------------------------
create table if not exists public.contract_types (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.contract_types (code, name) values
  ('SERVICE',     'خدمات'),
  ('SALE',        'فروش'),
  ('PURCHASE',    'خرید'),
  ('CONSULTING',  'مشاوره'),
  ('SOFTWARE',    'نرم‌افزار'),
  ('SUPPORT',     'پشتیبانی'),
  ('AGENCY',      'نمایندگی'),
  ('COOPERATION', 'همکاری'),
  ('SUPPLY',      'تأمین'),
  ('NDA',         'محرمانگی'),
  ('OTHER',       'سایر')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- contracts — core entity.
-- ---------------------------------------------------------------------
create table if not exists public.contracts (
  id                       uuid primary key default gen_random_uuid(),
  contract_type_id         uuid not null references public.contract_types(id),
  title                    text not null,
  kind                     contract_kind not null default 'NIL_ISSUED',

  sequence_number          integer,             -- null until finalized; NIL_ISSUED only
  display_number           text,                -- null until finalized; NIL_ISSUED only
  year                     integer,             -- Jalali numbering year; NIL_ISSUED only
  external_contract_number text,                -- required at creation for HISTORICAL, never for NIL_ISSUED
  external_source_note     text,

  counterparty_company_id  uuid references public.companies(id) on delete set null,
  case_id                  uuid references public.cases(id) on delete set null,

  status                   contract_status not null default 'DRAFT',
  effective_date           date,
  expiry_date              date,
  signed_date              date,

  base_amount              numeric(20,4),
  discount_amount          numeric(20,4) not null default 0,
  tax_amount               numeric(20,4) not null default 0,
  total_amount             numeric(20,4) generated always as
                              (coalesce(base_amount,0) - discount_amount + tax_amount) stored,
  currency_code            text not null default 'IRR',

  description              text,
  internal_notes           text,

  responsible_user         uuid references public.profiles(id) on delete set null,
  created_by               uuid not null references public.profiles(id),
  approved_by              uuid references public.profiles(id),
  approved_at              timestamptz,
  finalized_at             timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint ck_contract_money    check (base_amount is null or base_amount >= 0),
  constraint ck_contract_discount check (discount_amount >= 0),
  constraint ck_contract_tax      check (tax_amount >= 0),
  constraint ck_contract_dates    check (expiry_date is null or effective_date is null or expiry_date >= effective_date),

  -- A NIL_ISSUED contract has no number until it is numbered (mirrors
  -- correspondence's ck_corr_number_completeness); a HISTORICAL contract
  -- must carry its external number from creation and never gets an
  -- internal sequence number.
  constraint ck_contract_number_completeness check (
    (kind = 'NIL_ISSUED' and (
       (status in ('DRAFT','UNDER_REVIEW') and sequence_number is null)
       or (sequence_number is not null and display_number is not null and year is not null)
     ))
    or (kind = 'HISTORICAL' and external_contract_number is not null and sequence_number is null)
  )
);

-- Second line of defence for the numbering system, same pattern as
-- uq_corr_seq / uq_corr_display.
create unique index if not exists uq_contract_seq
  on public.contracts (year, sequence_number)
  where sequence_number is not null;

create unique index if not exists uq_contract_display
  on public.contracts (display_number)
  where display_number is not null;

create index if not exists idx_contracts_status on public.contracts (status);
create index if not exists idx_contracts_counterparty on public.contracts (counterparty_company_id);
create index if not exists idx_contracts_case on public.contracts (case_id);
create index if not exists idx_contracts_title on public.contracts using gin (title gin_trgm_ops);
create index if not exists idx_contracts_external on public.contracts using gin (external_contract_number gin_trgm_ops);

-- ---------------------------------------------------------------------
-- number_sequences — add the CONTRACT scope alongside OUTGOING/INCOMING/CASE.
-- ---------------------------------------------------------------------
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT'));

-- =====================================================================
-- NIL Office — 0020_contracts_core.sql
--
-- Contract Management, Phase 1: the core `contracts` table, its status
-- and role enums, and simple link columns from existing modules.
-- =====================================================================

do $$ begin
  create type contract_status as enum
    ('DRAFT','UNDER_REVIEW','APPROVED','ACTIVE','SUSPENDED','COMPLETED','EXPIRED','TERMINATED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contract_role as enum ('VIEW','CREATE','EDIT','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists contract_role contract_role;

-- number_sequences gains a third scope. CONTRACT is Jalali-year scoped
-- exactly like OUTGOING/INCOMING/CASE — unlike accounting, which is
-- fiscal-year scoped via its own dedicated accounting_sequences table.
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT'));

create table if not exists public.contracts (
  id                        uuid primary key default gen_random_uuid(),
  sequence_number           integer,
  display_number            text,
  year                      integer,
  title                     text not null,
  contract_type_id          uuid not null references public.contract_types(id),
  party_company_id          uuid references public.companies(id) on delete set null,
  party_contact_name        text,
  case_id                   uuid references public.cases(id) on delete set null,
  contract_date             date,
  effective_date            date,
  start_date                date,
  end_date                  date,
  currency_code             text not null default 'IRR',
  base_amount               numeric(20,4),
  tax_amount                numeric(20,4),
  total_amount              numeric(20,4),
  status                    contract_status not null default 'DRAFT',
  responsible_user_id       uuid references public.profiles(id) on delete set null,
  created_by                uuid not null references public.profiles(id),
  requires_guarantee        boolean not null default false,
  auto_renewal              boolean not null default false,
  description               text,
  internal_notes            text,
  is_historical             boolean not null default false,
  original_contract_number  text,
  original_contract_date    date,
  finalized_at              timestamptz,
  activated_at              timestamptz,
  completed_at              timestamptz,
  terminated_at             timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Each clause guards its own column independently (explicit parens —
  -- AND binds tighter than OR, so an ungrouped chain would let a null
  -- base_amount silently skip the tax/total checks too).
  constraint ck_contract_amounts check (
    (base_amount  is null or base_amount  >= 0) and
    (tax_amount   is null or tax_amount   >= 0) and
    (total_amount is null or total_amount >= 0)
  ),
  -- A record has no official number only while still pre-APPROVED, or if
  -- it's historical (which never gets a NIL number at all).
  constraint ck_contract_number_completeness check (
    is_historical
    or status in ('DRAFT','UNDER_REVIEW')
    or (sequence_number is not null and display_number is not null and year is not null)
  ),
  constraint ck_contract_historical_number check (
    not is_historical or original_contract_number is not null
  )
);

create unique index if not exists uq_contract_seq
  on public.contracts (year, sequence_number) where sequence_number is not null;
create unique index if not exists uq_contract_display
  on public.contracts (display_number) where display_number is not null;
create index if not exists idx_contracts_status on public.contracts (status);
create index if not exists idx_contracts_party  on public.contracts (party_company_id);
create index if not exists idx_contracts_case   on public.contracts (case_id);
create index if not exists idx_contracts_type   on public.contracts (contract_type_id);
create index if not exists idx_contracts_title  on public.contracts using gin (title gin_trgm_ops);
create index if not exists idx_contracts_display_trgm on public.contracts using gin (display_number gin_trgm_ops);

-- Link contracts to existing modules the same way `case_id` already links
-- documents/followups to cases: a plain nullable FK, not a polymorphic
-- junction table.
alter table public.correspondence add column if not exists contract_id uuid references public.contracts(id) on delete set null;
alter table public.documents      add column if not exists contract_id uuid references public.contracts(id) on delete set null;
alter table public.followups      add column if not exists contract_id uuid references public.contracts(id) on delete set null;
create index if not exists idx_corr_contract      on public.correspondence (contract_id);
create index if not exists idx_docs_contract      on public.documents (contract_id);
create index if not exists idx_followups_contract on public.followups (contract_id);

-- Contract files reuse the existing hardened attachment/storage architecture.
alter type attach_entity add value if not exists 'CONTRACT';

-- =====================================================================
-- NIL Office — 0040_crm_opportunities.sql
-- CRM module — business opportunities (spec §9). Trade-specific
-- structured fields (product/origin/destination/Incoterm/etc., spec
-- §15) and multi-party buyer/seller/broker relationships (spec §16)
-- are explicitly deferred to Phase 2 — this table stays type-agnostic.
--
-- Numbering: unlike contracts/sales_documents (legal documents with a
-- deferred numberless-draft state), an opportunity is numbered at
-- CREATION — sequence_number/opportunity_number/year are all NOT NULL
-- and stamped by tg_crm_opportunity_number (0043) in a BEFORE INSERT
-- trigger, which runs — and completes — before NOT NULL is checked, so
-- the app never supplies these columns itself.
-- =====================================================================

do $$ begin
  create type crm_opportunity_type as enum
    ('TRADE','SERVICE','PROJECT','PARTNERSHIP','AGENCY','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_opportunity_priority as enum ('LOW','NORMAL','HIGH','URGENT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_lost_reason as enum
    ('PRICE','NO_RESPONSE','COMPETITOR','PAYMENT_TERMS','DELIVERY',
     'COMPLIANCE','PRODUCT_UNAVAILABLE','CUSTOMER_CANCELLED','OTHER');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_opportunities (
  id                  uuid primary key default gen_random_uuid(),

  sequence_number     integer not null,
  opportunity_number  text not null,
  year                integer not null,

  title               text not null,

  company_id          uuid not null references public.companies(id) on delete restrict,
  primary_contact_id  uuid references public.company_contacts(id) on delete set null,
  case_id             uuid references public.cases(id) on delete set null,
  contract_id         uuid references public.contracts(id) on delete set null,

  opportunity_type    crm_opportunity_type not null default 'TRADE',
  pipeline_id         uuid not null references public.crm_pipelines(id) on delete restrict,
  stage_id            uuid not null references public.crm_pipeline_stages(id) on delete restrict,

  owner_user_id       uuid references public.profiles(id) on delete set null,

  currency_code       text not null default 'IRR'
    check (currency_code in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  estimated_value     numeric(20,4),
  probability         smallint check (probability between 0 and 100),

  expected_close_date date,

  source              text,
  priority            crm_opportunity_priority not null default 'NORMAL',

  description         text,
  internal_notes      text,

  lost_reason         crm_lost_reason,
  lost_reason_note    text,
  won_at              timestamptz,
  lost_at             timestamptz,

  next_action         text,
  next_action_date    date,

  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_crm_opportunity_seq on public.crm_opportunities (year, sequence_number);
create unique index if not exists uq_crm_opportunity_number on public.crm_opportunities (opportunity_number);

create index if not exists idx_crm_opportunities_company  on public.crm_opportunities (company_id);
create index if not exists idx_crm_opportunities_pipeline on public.crm_opportunities (pipeline_id);
create index if not exists idx_crm_opportunities_stage    on public.crm_opportunities (stage_id);
create index if not exists idx_crm_opportunities_owner    on public.crm_opportunities (owner_user_id);
create index if not exists idx_crm_opportunities_type     on public.crm_opportunities (opportunity_type);

-- ---------------------------------------------------------------------
-- number_sequences — add the OPPORTUNITY scope.
-- ---------------------------------------------------------------------
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY'));

-- ---------------------------------------------------------------------
-- crm_opportunity_stage_history — insert-only audit of every stage
-- move (including Won/Lost closures, which are just moves to a
-- terminal stage). Populated ONLY by tg_crm_opportunity_stage_history
-- (0043); no RLS insert/update/delete policy is ever granted on this
-- table (0044), so the app cannot forge it (spec §20/§40).
-- ---------------------------------------------------------------------
create table if not exists public.crm_opportunity_stage_history (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  from_stage_id  uuid references public.crm_pipeline_stages(id) on delete set null,
  to_stage_id    uuid not null references public.crm_pipeline_stages(id) on delete restrict,
  changed_by     uuid references public.profiles(id),
  changed_at     timestamptz not null default now(),
  note           text
);

create index if not exists idx_crm_opportunity_stage_history_opportunity
  on public.crm_opportunity_stage_history (opportunity_id, changed_at);

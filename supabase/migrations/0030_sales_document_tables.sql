-- =====================================================================
-- NIL Office — 0030_sales_document_tables.sql
-- Invoice/Proforma module — Phase 1 schema.
--
-- One shared table (`sales_documents`) for both PROFORMA and INVOICE
-- documents, distinguished by `type` — mirrors how `contracts.kind`
-- (NIL_ISSUED/HISTORICAL) shares one table rather than two, and matches
-- the spec's explicit "one shared architecture, not duplicated logic"
-- instruction. `contract_payment_milestone_id` is intentionally absent —
-- that table does not exist (Contract Phase 2/obligations was never
-- built) and was explicitly dropped from this phase, not deferred as an
-- unused column.
-- =====================================================================

do $$ begin
  create type sales_document_type as enum ('PROFORMA','INVOICE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sales_document_status as enum
    ('DRAFT','REVIEW','APPROVED','ISSUED','ACCEPTED','CONVERTED','EXPIRED',
     'PARTIALLY_SETTLED','SETTLED','OVERDUE','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sales_document_item_type as enum ('GOODS','SERVICE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists invoice_role invoice_role;

-- ---------------------------------------------------------------------
-- sales_documents — header.
-- ---------------------------------------------------------------------
create table if not exists public.sales_documents (
  id                       uuid primary key default gen_random_uuid(),
  type                     sales_document_type not null,
  status                   sales_document_status not null default 'DRAFT',

  sequence_number          integer,             -- null until issued
  display_number           text,                -- null until issued
  year                     integer,              -- Jalali numbering year

  company_id               uuid references public.companies(id) on delete set null,
  contract_id              uuid references public.contracts(id) on delete set null,
  case_id                  uuid references public.cases(id) on delete set null,

  converted_from_id        uuid references public.sales_documents(id) on delete set null,
  converted_to_id          uuid references public.sales_documents(id) on delete set null,
  converted_at             timestamptz,

  issue_date               date,
  due_date                 date,
  validity_date            date,

  currency_code            text not null default 'IRR'
    check (currency_code in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),

  -- Maintained ONLY by tg_sales_document_items_rollup (0031) — never
  -- written directly by app code. total_amount is a generated column,
  -- so Postgres itself rejects any attempt to set it.
  subtotal                 numeric(20,4) not null default 0,
  discount_amount          numeric(20,4) not null default 0,
  tax_amount               numeric(20,4) not null default 0,
  total_amount             numeric(20,4) generated always as
                              (subtotal - discount_amount + tax_amount) stored,

  payment_terms            text,
  notes                    text,

  -- Customer legal-info snapshot (spec §5) — frozen the moment the
  -- document leaves DRAFT/REVIEW (enforced app-side by
  -- updateSalesDocumentDraft, same mechanism contracts already use for
  -- "terms frozen after approval"). The 6 fields with a source column on
  -- companies are auto-copied server-side when company_id is chosen;
  -- the 4 that don't exist on companies at all are free-typed.
  customer_legal_name_snapshot         text not null,
  customer_english_name_snapshot       text,
  customer_registration_number_snapshot text,
  customer_national_id_snapshot         text,
  customer_economic_code_snapshot       text,
  customer_address_snapshot            text,
  customer_postal_code_snapshot        text,
  customer_contact_person_snapshot     text,
  customer_email_snapshot              text,
  customer_phone_snapshot              text,

  created_by                uuid not null references public.profiles(id),
  approved_by                uuid references public.profiles(id),
  approved_at                timestamptz,
  issued_by                  uuid references public.profiles(id),
  issued_at                  timestamptz,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  -- Each type only visits its own status subset.
  constraint ck_sales_document_status_type check (
    (type = 'PROFORMA' and status in
      ('DRAFT','REVIEW','APPROVED','ISSUED','ACCEPTED','CONVERTED','EXPIRED','CANCELLED'))
    or
    (type = 'INVOICE' and status in
      ('DRAFT','REVIEW','APPROVED','ISSUED','PARTIALLY_SETTLED','SETTLED','OVERDUE','CANCELLED'))
  ),

  -- Numberless while not yet issued (or cancelled before ever being
  -- issued — proactively includes the fix contracts needed a follow-up
  -- migration for, see 0025_contract_cancel_check_fix.sql); complete
  -- once numbered, for any status thereafter.
  constraint ck_sales_document_number_completeness check (
    (status in ('DRAFT','REVIEW','APPROVED','CANCELLED') and sequence_number is null)
    or (sequence_number is not null and display_number is not null and year is not null)
  )
);

create unique index if not exists uq_sales_document_seq
  on public.sales_documents (type, year, sequence_number)
  where sequence_number is not null;

create unique index if not exists uq_sales_document_display
  on public.sales_documents (display_number)
  where display_number is not null;

create index if not exists idx_sales_documents_status    on public.sales_documents (status);
create index if not exists idx_sales_documents_type       on public.sales_documents (type);
create index if not exists idx_sales_documents_company    on public.sales_documents (company_id);
create index if not exists idx_sales_documents_contract   on public.sales_documents (contract_id);
create index if not exists idx_sales_documents_case       on public.sales_documents (case_id);

-- ---------------------------------------------------------------------
-- sales_document_items — line items.
-- ---------------------------------------------------------------------
create table if not exists public.sales_document_items (
  id                  uuid primary key default gen_random_uuid(),
  sales_document_id   uuid not null references public.sales_documents(id) on delete cascade,
  line_no             integer not null,
  item_type           sales_document_item_type not null default 'SERVICE',
  description         text not null,
  unit                text,
  quantity            numeric(20,4) not null check (quantity > 0),
  unit_price          numeric(20,4) not null check (unit_price >= 0),
  discount_amount     numeric(20,4) not null default 0 check (discount_amount >= 0),
  tax_amount          numeric(20,4) not null default 0 check (tax_amount >= 0),
  line_total          numeric(20,4) generated always as
                         (quantity * unit_price - discount_amount + tax_amount) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_sales_document_items_document on public.sales_document_items (sales_document_id);

-- ---------------------------------------------------------------------
-- number_sequences — add the PROFORMA/INVOICE scopes.
-- ---------------------------------------------------------------------
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE'));

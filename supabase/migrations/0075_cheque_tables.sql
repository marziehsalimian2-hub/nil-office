-- =====================================================================
-- NIL Office — 0075_cheque_tables.sql
-- Cheque Management & Printing v1 — core schema. Two directions share
-- one `cheques` table:
--   PAYABLE    — a cheque NIL Office writes from its own cheque_books
--                (bank_account_id -> existing public.bank_accounts,
--                never duplicated), gets prepared/issued/delivered and
--                physically printed.
--   RECEIVABLE — a cheque NIL Office received from another company. No
--                cheque_books row exists for someone else's chequebook,
--                so the drawer's bank info is stored inline instead; it
--                is never printed, only recorded/deposited/cleared.
--
-- v1 simplification (documented, not a spec violation): the AVAILABLE
-- status exists in the enum for spec-literal compliance but is never
-- actually assigned in this version — a "blank leaf inventory" (one
-- pre-created AVAILABLE row per leaf in a book) is out of scope for v1;
-- cheque_books' first/last_cheque_number/leaves_count stay informational
-- metadata, and cheque_number uniqueness is enforced directly at DRAFT
-- creation (create_cheque_draft, 0077). See CHEQUE_MODULE.md.
--
-- No-silent-modification (spec §25) is split across two mechanisms:
-- RLS blocks a plain UPDATE from ever touching `status` once it has left
-- DRAFT (0078); a column-level immutability trigger here additionally
-- blocks amount/counterparty/date/number changes via ANY path (including
-- a SECURITY DEFINER function) once status has left DRAFT.
-- =====================================================================

do $$ begin create type cheque_book_status as enum ('ACTIVE','COMPLETED','CANCELLED','ARCHIVED'); exception when duplicate_object then null; end $$;
do $$ begin create type cheque_direction   as enum ('PAYABLE','RECEIVABLE'); exception when duplicate_object then null; end $$;
do $$ begin create type cheque_status as enum (
  'AVAILABLE','DRAFT','PREPARED','ISSUED','DELIVERED',
  'RECEIVED','DEPOSITED',
  'CLEARED','RETURNED','CANCELLED','VOID'
); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1. cheque_books — PAYABLE-only concept, our own chequebooks.
-- ---------------------------------------------------------------------
create table if not exists public.cheque_books (
  id                   uuid primary key default gen_random_uuid(),
  bank_account_id      uuid not null references public.bank_accounts(id) on delete restrict,
  book_identifier      text not null,
  first_cheque_number  text not null,
  last_cheque_number   text not null,
  leaves_count         int not null check (leaves_count > 0),
  issue_date           date not null,
  status               cheque_book_status not null default 'ACTIVE',
  description          text,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists uq_cheque_book_identifier on public.cheque_books(bank_account_id, book_identifier);
create index if not exists idx_cheque_books_bank_account on public.cheque_books(bank_account_id);
create index if not exists idx_cheque_books_status on public.cheque_books(status);

-- ---------------------------------------------------------------------
-- 2. cheques — direction-aware, single table for both flows.
-- ---------------------------------------------------------------------
create table if not exists public.cheques (
  id                    uuid primary key default gen_random_uuid(),
  direction             cheque_direction not null,

  cheque_book_id        uuid references public.cheque_books(id) on delete restrict,

  cheque_number         text not null,
  sayad_id              text,
  display_number        text,
  year                  int,
  sequence_number       int,

  counterparty_company_id    uuid references public.companies(id) on delete set null,
  counterparty_name_snapshot text not null,

  drawer_bank_name      text,
  drawer_branch         text,
  drawer_account_number text,

  amount                numeric(20,4) not null check (amount > 0),
  currency_code         text not null default 'IRR'
                          check (currency_code in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  amount_in_words       text not null,

  cheque_date           date not null,
  purpose               text,
  description           text,

  status                cheque_status not null default 'DRAFT',

  company_id            uuid references public.companies(id) on delete set null,
  contract_id           uuid references public.contracts(id) on delete set null,
  sales_document_id     uuid references public.sales_documents(id) on delete set null,
  case_id               uuid references public.cases(id) on delete set null,
  project_id            uuid references public.projects(id) on delete set null,

  payment_id            uuid references public.payments(id) on delete set null,
  receipt_id            uuid references public.receipts(id) on delete set null,

  print_template_id     uuid,
  first_printed_at      timestamptz,
  last_printed_at       timestamptz,
  print_count           int not null default 0,
  printed_by            uuid references public.profiles(id),

  prepared_at   timestamptz,
  issued_at     timestamptz,
  delivered_at  timestamptz,
  received_at   timestamptz,
  deposited_at  timestamptz,
  cleared_at    timestamptz,
  returned_at   timestamptz, return_reason text,
  voided_at     timestamptz, void_reason text,
  cancelled_at  timestamptz, cancel_reason text,

  created_by            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint chk_cheque_book_required_for_payable
    check (direction = 'RECEIVABLE' or cheque_book_id is not null),
  constraint chk_drawer_bank_required_for_receivable
    check (direction = 'PAYABLE' or drawer_bank_name is not null)
);

create unique index if not exists uq_payable_cheque_number
  on public.cheques(cheque_book_id, cheque_number) where direction = 'PAYABLE';
create unique index if not exists uq_receivable_cheque_number
  on public.cheques(drawer_bank_name, drawer_account_number, cheque_number) where direction = 'RECEIVABLE';
create unique index if not exists uq_cheque_sayad on public.cheques(sayad_id) where sayad_id is not null;

create index if not exists idx_cheques_status on public.cheques(status);
create index if not exists idx_cheques_direction on public.cheques(direction);
create index if not exists idx_cheques_cheque_date on public.cheques(cheque_date);
create index if not exists idx_cheques_counterparty_company on public.cheques(counterparty_company_id);
create index if not exists idx_cheques_company on public.cheques(company_id);
create index if not exists idx_cheques_contract on public.cheques(contract_id);
create index if not exists idx_cheques_sales_document on public.cheques(sales_document_id);
create index if not exists idx_cheques_book on public.cheques(cheque_book_id);

-- ---------------------------------------------------------------------
-- 3. cheque_status_transitions — reference data only, looked up (never
--    written to) by the RPCs in 0077. A CHECK constraint can't see the
--    OLD row so it can't express a transition, and a generic trigger
--    would duplicate the per-transition role-gating/audit those RPCs
--    already have to do — so this stays a plain lookup table.
-- ---------------------------------------------------------------------
create table if not exists public.cheque_status_transitions (
  direction   cheque_direction not null,
  from_status cheque_status not null,
  to_status   cheque_status not null,
  primary key (direction, from_status, to_status)
);

insert into public.cheque_status_transitions (direction, from_status, to_status) values
  ('PAYABLE','DRAFT','PREPARED'),
  ('PAYABLE','PREPARED','ISSUED'),
  ('PAYABLE','ISSUED','DELIVERED'),
  ('PAYABLE','DELIVERED','CLEARED'),
  ('PAYABLE','ISSUED','RETURNED'),
  ('PAYABLE','DELIVERED','RETURNED'),
  ('PAYABLE','DRAFT','CANCELLED'),
  ('PAYABLE','PREPARED','CANCELLED'),
  ('PAYABLE','PREPARED','VOID'),
  ('PAYABLE','ISSUED','VOID'),
  ('PAYABLE','DELIVERED','VOID'),
  ('RECEIVABLE','DRAFT','RECEIVED'),
  ('RECEIVABLE','RECEIVED','DEPOSITED'),
  ('RECEIVABLE','DEPOSITED','CLEARED'),
  ('RECEIVABLE','DEPOSITED','RETURNED'),
  ('RECEIVABLE','DRAFT','CANCELLED'),
  ('RECEIVABLE','RECEIVED','CANCELLED')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. touch/audit triggers — mirrors 0066_trade_portal.sql:307-326.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cheque_books','cheques']
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
-- 5. tg_cheque_number — numbers a cheque row at INSERT (like trade_offers
--    / CRM opportunities: no deferred-draft numbering gap needed).
--    display_number is NIL Office's own internal reference — separate
--    from cheque_number, the physical number printed on the bank leaf.
-- ---------------------------------------------------------------------
create or replace function public.tg_cheque_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int;
  v_seq  int;
begin
  v_year := public.jalali_year(now());
  v_seq  := public.allocate_sequence('CHEQUE', v_year);

  new.year            := v_year;
  new.sequence_number := v_seq;
  new.display_number  := public.format_display_number('CHEQUE', v_year, v_seq);

  return new;
end;
$$;

drop trigger if exists trg_cheque_number on public.cheques;
create trigger trg_cheque_number
  before insert on public.cheques
  for each row execute function public.tg_cheque_number();

-- ---------------------------------------------------------------------
-- 6. tg_cheques_immutability — spec §25: amount/counterparty/date/number
--    become immutable via ANY write path (not just the app's own RLS-
--    gated UPDATE, which 0078 additionally restricts) once a cheque has
--    ever left DRAFT. Corrections go through VOID/CANCEL + a new row.
-- ---------------------------------------------------------------------
create or replace function public.tg_cheques_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status not in ('DRAFT') then
    if new.amount is distinct from old.amount
       or new.currency_code is distinct from old.currency_code
       or new.counterparty_company_id is distinct from old.counterparty_company_id
       or new.counterparty_name_snapshot is distinct from old.counterparty_name_snapshot
       or new.cheque_date is distinct from old.cheque_date
       or new.cheque_number is distinct from old.cheque_number
    then
      raise exception 'IMMUTABLE_FIELD_CHANGED' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cheques_immutability on public.cheques;
create trigger trg_cheques_immutability
  before update on public.cheques
  for each row execute function public.tg_cheques_immutability();

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop trigger if exists trg_cheques_immutability on public.cheques;
-- drop function if exists public.tg_cheques_immutability();
-- drop trigger if exists trg_cheque_number on public.cheques;
-- drop function if exists public.tg_cheque_number();
-- drop trigger if exists trg_audit_cheques on public.cheques;
-- drop trigger if exists trg_touch_cheques on public.cheques;
-- drop trigger if exists trg_audit_cheque_books on public.cheque_books;
-- drop trigger if exists trg_touch_cheque_books on public.cheque_books;
-- drop table if exists public.cheque_status_transitions;
-- drop table if exists public.cheques;
-- drop table if exists public.cheque_books;
-- drop type if exists cheque_status;
-- drop type if exists cheque_direction;
-- drop type if exists cheque_book_status;
-- =====================================================================

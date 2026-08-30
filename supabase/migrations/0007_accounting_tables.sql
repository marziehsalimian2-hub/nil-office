-- 0007 — Accounting Schema (corrected trigger function name)
do $$ begin create type fiscal_year_status as enum ('OPEN','CLOSED'); exception when duplicate_object then null; end $$;
do $$ begin create type account_nature     as enum ('DEBIT','CREDIT'); exception when duplicate_object then null; end $$;
do $$ begin create type account_type       as enum ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'); exception when duplicate_object then null; end $$;
do $$ begin create type posting_status     as enum ('DRAFT','POSTED','REVERSED'); exception when duplicate_object then null; end $$;
do $$ begin create type detail_kind        as enum ('CUSTOMER','SUPPLIER','EMPLOYEE','SHAREHOLDER','OTHER'); exception when duplicate_object then null; end $$;
do $$ begin create type bank_kind          as enum ('BANK','CASH'); exception when duplicate_object then null; end $$;
do $$ begin create type accounting_role    as enum ('VIEW','CREATE','POST','ADMIN'); exception when duplicate_object then null; end $$;

alter type attach_entity add value if not exists 'JOURNAL';
alter type attach_entity add value if not exists 'RECEIPT';
alter type attach_entity add value if not exists 'PAYMENT';

alter table public.profiles add column if not exists accounting_role accounting_role;

create table if not exists public.app_settings (
  id                 int primary key default 1 check (id = 1),
  base_currency_code text not null default 'IRR',
  display_unit       text not null default 'RIAL' check (display_unit in ('RIAL','TOMAN')),
  updated_at         timestamptz not null default now()
);

create table if not exists public.fiscal_years (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  start_date date not null,
  end_date   date not null,
  status     fiscal_year_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  constraint ck_fy_range check (end_date > start_date)
);
create index if not exists idx_fy_status on public.fiscal_years (status);

create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  parent_id      uuid references public.accounts(id),
  level          int  not null check (level between 1 and 4),
  nature         account_nature not null,
  account_type   account_type   not null,
  is_active      boolean not null default true,
  allows_posting boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_accounts_parent on public.accounts (parent_id);
create index if not exists idx_accounts_type   on public.accounts (account_type);
create index if not exists idx_accounts_post   on public.accounts (allows_posting);

create table if not exists public.detail_accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,
  name       text not null,
  kind       detail_kind not null default 'OTHER',
  company_id uuid references public.companies(id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_detail_company on public.detail_accounts (company_id);

create table if not exists public.accounting_sequences (
  id             uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null unique references public.fiscal_years(id) on delete cascade,
  last_value     bigint not null default 0 check (last_value >= 0),
  updated_at     timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  fiscal_year_id  uuid not null references public.fiscal_years(id),
  document_number text unique,
  document_date   date not null,
  description     text,
  status          posting_status not null default 'DRAFT',
  reference       text,
  reversal_of     uuid references public.journal_entries(id),
  created_by      uuid references public.profiles(id),
  posted_by       uuid references public.profiles(id),
  posted_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_je_fy     on public.journal_entries (fiscal_year_id);
create index if not exists idx_je_status on public.journal_entries (status);
create index if not exists idx_je_date   on public.journal_entries (document_date);

create table if not exists public.journal_entry_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null references public.journal_entries(id) on delete cascade,
  account_id        uuid not null references public.accounts(id),
  detail_account_id uuid references public.detail_accounts(id),
  description       text,
  debit             numeric(20,4) not null default 0 check (debit  >= 0),
  credit            numeric(20,4) not null default 0 check (credit >= 0),
  company_id        uuid references public.companies(id),
  case_id           uuid references public.cases(id),
  currency_code     text,
  foreign_amount    numeric(20,4),
  exchange_rate     numeric(20,10),
  line_no           int,
  created_at        timestamptz not null default now(),
  constraint ck_line_not_both  check (not (debit > 0 and credit > 0)),
  constraint ck_line_not_empty check (debit > 0 or credit > 0)
);
create index if not exists idx_jel_entry   on public.journal_entry_lines (journal_entry_id);
create index if not exists idx_jel_account on public.journal_entry_lines (account_id);
create index if not exists idx_jel_detail  on public.journal_entry_lines (detail_account_id);
create index if not exists idx_jel_company on public.journal_entry_lines (company_id);
create index if not exists idx_jel_case    on public.journal_entry_lines (case_id);

create table if not exists public.bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  kind           bank_kind not null default 'BANK',
  bank_name      text,
  branch         text,
  account_title  text not null,
  account_number text,
  iban           text,
  currency_code  text not null default 'IRR',
  account_id     uuid references public.accounts(id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.receipts (
  id                     uuid primary key default gen_random_uuid(),
  receipt_date           date not null,
  payer                  text,
  amount                 numeric(20,4) not null check (amount > 0),
  currency_code          text not null default 'IRR',
  bank_account_id        uuid references public.bank_accounts(id),
  counterpart_account_id uuid references public.accounts(id),
  detail_account_id      uuid references public.detail_accounts(id),
  method                 text,
  reference              text,
  description            text,
  company_id             uuid references public.companies(id),
  case_id                uuid references public.cases(id),
  fiscal_year_id         uuid references public.fiscal_years(id),
  status                 posting_status not null default 'DRAFT',
  journal_entry_id       uuid references public.journal_entries(id),
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_receipts_status  on public.receipts (status);
create index if not exists idx_receipts_company on public.receipts (company_id);
create index if not exists idx_receipts_case    on public.receipts (case_id);

create table if not exists public.payments (
  id                     uuid primary key default gen_random_uuid(),
  payment_date           date not null,
  payee                  text,
  amount                 numeric(20,4) not null check (amount > 0),
  currency_code          text not null default 'IRR',
  bank_account_id        uuid references public.bank_accounts(id),
  counterpart_account_id uuid references public.accounts(id),
  detail_account_id      uuid references public.detail_accounts(id),
  method                 text,
  reference              text,
  description            text,
  company_id             uuid references public.companies(id),
  case_id                uuid references public.cases(id),
  fiscal_year_id         uuid references public.fiscal_years(id),
  status                 posting_status not null default 'DRAFT',
  journal_entry_id       uuid references public.journal_entries(id),
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_payments_status  on public.payments (status);
create index if not exists idx_payments_company on public.payments (company_id);
create index if not exists idx_payments_case    on public.payments (case_id);

do $$
declare t text;
begin
  foreach t in array array[
    'fiscal_years','accounts','detail_accounts','journal_entries',
    'bank_accounts','receipts','payments','app_settings'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on public.%1$s;
       create trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
  end loop;
end $$;
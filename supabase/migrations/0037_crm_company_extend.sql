-- =====================================================================
-- NIL Office — 0037_crm_company_extend.sql
-- CRM module — extend the EXISTING companies table (the CRM company
-- master, per spec §2: no separate customers/suppliers/counterparties
-- table) with a relationship status, an internal owner, and a
-- normalized multi-role set (a company may be BUYER and PARTNER at
-- once — spec §2's example — hence a junction table, not a single enum
-- column). companies' own RLS (0004_rls.sql) already lets any active
-- user select/insert/update it, so these new columns need no RLS of
-- their own; only the new crm_company_roles table does.
-- =====================================================================

do $$ begin
  create type crm_company_status as enum ('PROSPECT','ACTIVE','INACTIVE','BLOCKED','ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_company_role as enum
    ('CUSTOMER','PROSPECT','LEAD','BUYER','SELLER','SUPPLIER','PARTNER',
     'AGENT','BROKER','SERVICE_PROVIDER','OTHER');
exception when duplicate_object then null; end $$;

alter table public.companies add column if not exists crm_status crm_company_status not null default 'PROSPECT';
alter table public.companies add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_companies_crm_status on public.companies (crm_status);
create index if not exists idx_companies_owner       on public.companies (owner_user_id);

-- Surrogate id (not a composite PK) so the generic tg_audit() trigger
-- (which assumes a single `id` column, see 0003_functions.sql) can be
-- attached — role changes must be auditable per spec §40.
create table if not exists public.crm_company_roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        crm_company_role not null,
  created_at  timestamptz not null default now(),
  unique (company_id, role)
);

create index if not exists idx_crm_company_roles_company on public.crm_company_roles (company_id);

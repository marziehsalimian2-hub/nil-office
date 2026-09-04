-- =====================================================================
-- NIL Office — 0038_crm_contacts.sql
-- CRM module — contact persons, linked to the existing companies table
-- (spec §4/§5). A company may have multiple contacts; people are never
-- stored as free text inside Company notes.
-- =====================================================================

do $$ begin
  create type crm_contact_role as enum
    ('OWNER','CEO','MANAGING_DIRECTOR','COMMERCIAL_MANAGER','SALES',
     'PROCUREMENT','FINANCE','LEGAL','TECHNICAL','REPRESENTATIVE',
     'BROKER','OTHER');
exception when duplicate_object then null; end $$;

create table if not exists public.company_contacts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,

  first_name          text not null,
  last_name           text,
  job_title           text,
  department          text,
  contact_role        crm_contact_role,

  email               text,
  phone               text,
  mobile              text,
  whatsapp            text,
  telegram            text,

  country             text,
  city                text,

  is_primary          boolean not null default false,
  is_decision_maker   boolean not null default false,
  is_active           boolean not null default true,

  preferred_language  text,
  notes               text,

  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_company_contacts_company on public.company_contacts (company_id);
create index if not exists idx_company_contacts_name on public.company_contacts
  using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

-- At most one primary contact per company.
create unique index if not exists uq_company_contacts_primary
  on public.company_contacts (company_id)
  where is_primary;

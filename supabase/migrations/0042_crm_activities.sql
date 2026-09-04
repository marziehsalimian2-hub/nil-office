-- =====================================================================
-- NIL Office — 0042_crm_activities.sql
-- CRM module — activity/timeline entries (spec §7/§8): calls, emails,
-- meetings, notes, etc. against a Company (and optionally a specific
-- Contact/Opportunity/Case), forming the chronological business
-- relationship history shown on Company 360° and the Opportunity page.
-- =====================================================================

do $$ begin
  create type crm_activity_type as enum
    ('CALL','EMAIL','WHATSAPP','TELEGRAM','MEETING','VIDEO_CALL','NOTE',
     'NEGOTIATION','QUOTATION_SENT','QUOTATION_RECEIVED',
     'DOCUMENT_SENT','DOCUMENT_RECEIVED','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_activity_direction as enum ('INBOUND','OUTBOUND','INTERNAL');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_activities (
  id                uuid primary key default gen_random_uuid(),

  company_id        uuid not null references public.companies(id) on delete cascade,
  contact_id        uuid references public.company_contacts(id) on delete set null,
  opportunity_id    uuid references public.crm_opportunities(id) on delete set null,
  case_id           uuid references public.cases(id) on delete set null,

  activity_type     crm_activity_type not null,
  activity_date     timestamptz not null default now(),

  subject           text not null,
  summary           text,

  direction         crm_activity_direction not null default 'INTERNAL',

  responsible_user_id uuid references public.profiles(id) on delete set null,
  created_by          uuid references public.profiles(id),

  next_action       text,
  next_action_date  date,

  created_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_crm_activities_company     on public.crm_activities (company_id, activity_date desc);
create index if not exists idx_crm_activities_opportunity on public.crm_activities (opportunity_id, activity_date desc);
create index if not exists idx_crm_activities_contact     on public.crm_activities (contact_id);

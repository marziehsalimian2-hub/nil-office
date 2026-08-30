-- =====================================================================
-- NIL Office — 0002_tables.sql
-- Schema: 10 operational tables + supporting keys, constraints, indexes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  title       text,                               -- job title, shown as signatory
  role        app_role    not null default 'USER',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- companies / counterparties
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id             uuid primary key default gen_random_uuid(),
  legal_name     text not null,
  english_name   text,
  country        text,
  contact_person text,
  email          text,
  phone          text,
  address        text,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_companies_legal_name on public.companies using gin (legal_name gin_trgm_ops);
create index if not exists idx_companies_english_name on public.companies using gin (english_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- number_sequences  (generic, per scope + Jalali year)
-- scope: 'OUTGOING' | 'INCOMING' | 'CASE'
-- ---------------------------------------------------------------------
create table if not exists public.number_sequences (
  id          uuid primary key default gen_random_uuid(),
  scope       text    not null,
  year        integer not null,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now(),
  constraint uq_sequence_scope_year unique (scope, year),
  constraint ck_sequence_scope check (scope in ('OUTGOING','INCOMING','CASE')),
  constraint ck_sequence_nonneg check (last_value >= 0)
);

-- ---------------------------------------------------------------------
-- cases  (group related correspondence / documents / follow-ups)
-- ---------------------------------------------------------------------
create table if not exists public.cases (
  id               uuid primary key default gen_random_uuid(),
  case_code        text unique,                    -- CASE-1405-0012 (auto)
  title            text not null,
  case_type        text,
  company_id       uuid references public.companies(id) on delete set null,
  description      text,
  responsible_user uuid references public.profiles(id) on delete set null,
  start_date       date,
  status           case_status not null default 'ACTIVE',
  tags             text[] not null default '{}',
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_cases_status on public.cases (status);
create index if not exists idx_cases_company on public.cases (company_id);
create index if not exists idx_cases_title on public.cases using gin (title gin_trgm_ops);
create index if not exists idx_cases_code on public.cases using gin (case_code gin_trgm_ops);

-- ---------------------------------------------------------------------
-- correspondence  (official incoming/outgoing letters)
-- ---------------------------------------------------------------------
create table if not exists public.correspondence (
  id                    uuid primary key default gen_random_uuid(),
  direction             corr_direction not null,
  sequence_number       integer,                  -- null until numbered
  display_number        text,                     -- null until numbered
  year                  integer,                  -- Jalali year of numbering
  language              corr_language not null default 'FA',
  subject               text,
  sender_company_id     uuid references public.companies(id) on delete set null,
  recipient_company_id  uuid references public.companies(id) on delete set null,
  recipient_name        text,
  case_id               uuid references public.cases(id) on delete set null,
  created_by            uuid not null references public.profiles(id),
  signatory_id          uuid references public.profiles(id) on delete set null,
  assigned_to           uuid references public.profiles(id) on delete set null,
  status                corr_status   not null default 'DRAFT',
  priority              corr_priority not null default 'NORMAL',
  requires_response     boolean not null default false,
  followup_date         date,
  sent_received_method  text,
  sent_received_at      timestamptz,
  external_letter_number text,
  external_letter_date  date,
  draft_text            text,
  internal_notes        text,
  finalized_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- A record either has no number (only while DRAFT/REVIEW) or carries a
  -- complete official identity. Once numbered it can never become numberless.
  constraint ck_corr_number_completeness check (
    (status in ('DRAFT','REVIEW') and sequence_number is null)
    or (sequence_number is not null and display_number is not null and year is not null and subject is not null)
  )
);

-- Second line of defence for the numbering system: even if application
-- logic were bypassed, two letters can never share a number.
create unique index if not exists uq_corr_seq
  on public.correspondence (direction, year, sequence_number)
  where sequence_number is not null;

create unique index if not exists uq_corr_display
  on public.correspondence (display_number)
  where display_number is not null;

create index if not exists idx_corr_direction_status on public.correspondence (direction, status);
create index if not exists idx_corr_case on public.correspondence (case_id);
create index if not exists idx_corr_created_at on public.correspondence (created_at desc);
create index if not exists idx_corr_followup on public.correspondence (followup_date) where requires_response;
create index if not exists idx_corr_subject on public.correspondence using gin (subject gin_trgm_ops);
create index if not exists idx_corr_display_trgm on public.correspondence using gin (display_number gin_trgm_ops);
create index if not exists idx_corr_external on public.correspondence using gin (external_letter_number gin_trgm_ops);

-- ---------------------------------------------------------------------
-- correspondence_links  (reply-to / related-to graph)
-- ---------------------------------------------------------------------
create table if not exists public.correspondence_links (
  id                     uuid primary key default gen_random_uuid(),
  from_correspondence_id uuid not null references public.correspondence(id) on delete cascade,
  to_correspondence_id   uuid not null references public.correspondence(id) on delete cascade,
  relation_type          link_relation not null default 'RELATED_TO',
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  constraint ck_link_not_self check (from_correspondence_id <> to_correspondence_id),
  constraint uq_link unique (from_correspondence_id, to_correspondence_id, relation_type)
);
create index if not exists idx_links_from on public.correspondence_links (from_correspondence_id);
create index if not exists idx_links_to on public.correspondence_links (to_correspondence_id);

-- ---------------------------------------------------------------------
-- documents  (archived files that are NOT correspondence)
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  document_type document_type not null default 'OTHER',
  case_id       uuid references public.cases(id) on delete set null,
  company_id    uuid references public.companies(id) on delete set null,
  document_date date,
  received_date date,
  version       text,
  description   text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_documents_type on public.documents (document_type);
create index if not exists idx_documents_case on public.documents (case_id);
create index if not exists idx_documents_title on public.documents using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------
-- attachments  (reusable, polymorphic: correspondence | document | case)
-- ---------------------------------------------------------------------
create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  entity_type  attach_entity not null,
  entity_id    uuid not null,
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  constraint ck_attach_size check (size_bytes is null or size_bytes >= 0)
);
create index if not exists idx_attachments_entity on public.attachments (entity_type, entity_id);

-- ---------------------------------------------------------------------
-- followups
-- ---------------------------------------------------------------------
create table if not exists public.followups (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  due_date          date not null,
  assigned_to       uuid references public.profiles(id) on delete set null,
  correspondence_id uuid references public.correspondence(id) on delete set null,
  case_id           uuid references public.cases(id) on delete set null,
  status            followup_status not null default 'OPEN',
  note              text,
  completed_at      timestamptz,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_followups_status_due on public.followups (status, due_date);
create index if not exists idx_followups_assigned on public.followups (assigned_to);

-- ---------------------------------------------------------------------
-- activity_logs  (audit trail — append only for normal users)
-- ---------------------------------------------------------------------
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id),
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_logs_entity on public.activity_logs (entity_type, entity_id);
create index if not exists idx_logs_created_at on public.activity_logs (created_at desc);

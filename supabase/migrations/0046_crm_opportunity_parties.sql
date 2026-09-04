-- =====================================================================
-- NIL Office — 0046_crm_opportunity_parties.sql
-- CRM module Phase 2 — multi-party relationships on an opportunity
-- (spec §16). Normalized junction table rather than a growing set of
-- fixed FK columns (broker_company_id, logistics_company_id, ...) —
-- spec's own explicit recommendation.
-- =====================================================================

do $$ begin
  create type crm_opportunity_party_role as enum
    ('BUYER','SELLER','SUPPLIER','BROKER','AGENT','END_BUYER','END_SELLER','LOGISTICS','OTHER');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_opportunity_parties (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,

  -- A party row is a weak link — unlike crm_opportunities.company_id
  -- itself (on delete restrict), losing a participant company should
  -- just drop the participation record, not block deletion.
  company_id     uuid not null references public.companies(id) on delete cascade,
  contact_id     uuid references public.company_contacts(id) on delete set null,

  role           crm_opportunity_party_role not null,
  notes          text,

  created_at     timestamptz not null default now(),

  unique (opportunity_id, company_id, role)
);

create index if not exists idx_crm_opportunity_parties_opportunity on public.crm_opportunity_parties (opportunity_id);
create index if not exists idx_crm_opportunity_parties_company     on public.crm_opportunity_parties (company_id);

drop trigger if exists trg_audit_crm_opportunity_parties on public.crm_opportunity_parties;
create trigger trg_audit_crm_opportunity_parties
  after insert or update or delete on public.crm_opportunity_parties
  for each row execute function public.tg_audit();

alter table public.crm_opportunity_parties enable row level security;

drop policy if exists p_crm_opportunity_parties_read   on public.crm_opportunity_parties;
drop policy if exists p_crm_opportunity_parties_write  on public.crm_opportunity_parties;
drop policy if exists p_crm_opportunity_parties_update on public.crm_opportunity_parties;
drop policy if exists p_crm_opportunity_parties_delete on public.crm_opportunity_parties;
create policy p_crm_opportunity_parties_read   on public.crm_opportunity_parties for select using (public.has_crm_access());
create policy p_crm_opportunity_parties_write  on public.crm_opportunity_parties for insert with check (public.can_create_crm());
create policy p_crm_opportunity_parties_update on public.crm_opportunity_parties for update using (public.can_create_crm()) with check (public.can_create_crm());
create policy p_crm_opportunity_parties_delete on public.crm_opportunity_parties for delete using (public.can_create_crm());

grant select, insert, update, delete on public.crm_opportunity_parties to authenticated;

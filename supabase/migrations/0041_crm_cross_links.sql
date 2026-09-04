-- =====================================================================
-- NIL Office — 0041_crm_cross_links.sql
-- CRM module — additive nullable FK columns onto existing tables, so an
-- Opportunity/Company can be traced from a Contract, Sales Document,
-- Correspondence item, or Follow-up without duplicating any of those
-- modules. Follows the SAME convention those tables already use
-- (specific nullable FK columns — e.g. followups.case_id,
-- correspondence.sender_company_id) rather than inventing a generic
-- entity-reference pattern.
-- =====================================================================

alter table public.contracts       add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;
alter table public.sales_documents add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;
alter table public.correspondence  add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;

alter table public.followups add column if not exists company_id     uuid references public.companies(id) on delete set null;
alter table public.followups add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;

create index if not exists idx_contracts_opportunity       on public.contracts (opportunity_id);
create index if not exists idx_sales_documents_opportunity  on public.sales_documents (opportunity_id);
create index if not exists idx_correspondence_opportunity   on public.correspondence (opportunity_id);
create index if not exists idx_followups_company            on public.followups (company_id);
create index if not exists idx_followups_opportunity        on public.followups (opportunity_id);

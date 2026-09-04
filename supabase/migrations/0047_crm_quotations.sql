-- =====================================================================
-- NIL Office — 0047_crm_quotations.sql
-- CRM module Phase 2 — lightweight internal quotation/offer tracking on
-- an opportunity (spec §17). Deliberately NOT a duplicate of the
-- Invoice/Proforma module: no status workflow, no numbering, no PDF.
-- If a quotation becomes a real Proforma, the existing "صدور
-- پیش‌فاکتور" action (Phase 1, app/actions/crm-opportunities.ts) is
-- used — linkage stays at the opportunity level via
-- sales_documents.opportunity_id, not per-quotation.
-- =====================================================================

do $$ begin
  create type crm_quotation_direction as enum ('SENT','RECEIVED');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_quotations (
  id                  uuid primary key default gen_random_uuid(),
  opportunity_id      uuid not null references public.crm_opportunities(id) on delete cascade,

  direction           crm_quotation_direction not null default 'SENT',

  buyer_company_id    uuid references public.companies(id) on delete set null,
  seller_company_id   uuid references public.companies(id) on delete set null,

  product_name        text,
  quantity             numeric(20,4),
  unit                 text,
  unit_price           numeric(20,4),
  currency_code         text
    check (currency_code is null or currency_code in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),

  incoterm               text,
  origin_country          text,
  destination_country     text,
  validity_date            date,
  payment_terms             text,
  notes                     text,

  created_by                uuid references public.profiles(id),
  created_at                 timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_crm_quotations_opportunity on public.crm_quotations (opportunity_id);

drop trigger if exists trg_touch_crm_quotations on public.crm_quotations;
create trigger trg_touch_crm_quotations
  before update on public.crm_quotations
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_audit_crm_quotations on public.crm_quotations;
create trigger trg_audit_crm_quotations
  after insert or update or delete on public.crm_quotations
  for each row execute function public.tg_audit();

alter table public.crm_quotations enable row level security;

drop policy if exists p_crm_quotations_read   on public.crm_quotations;
drop policy if exists p_crm_quotations_write  on public.crm_quotations;
drop policy if exists p_crm_quotations_update on public.crm_quotations;
drop policy if exists p_crm_quotations_delete on public.crm_quotations;
create policy p_crm_quotations_read   on public.crm_quotations for select using (public.has_crm_access());
create policy p_crm_quotations_write  on public.crm_quotations for insert with check (public.can_create_crm());
create policy p_crm_quotations_update on public.crm_quotations for update using (public.can_create_crm()) with check (public.can_create_crm());
create policy p_crm_quotations_delete on public.crm_quotations for delete using (public.can_create_crm());

grant select, insert, update, delete on public.crm_quotations to authenticated;

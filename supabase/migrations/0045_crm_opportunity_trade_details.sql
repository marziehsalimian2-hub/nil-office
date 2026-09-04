-- =====================================================================
-- NIL Office — 0045_crm_opportunity_trade_details.sql
-- CRM module Phase 2 — structured trade-deal fields (spec §15), kept on
-- a separate 1:1 side table rather than new columns on crm_opportunities
-- since they're only meaningful for opportunity_type = 'TRADE'. Mirrors
-- how sales_documents keeps customer_*_snapshot fields on its own row
-- rather than polluting companies.
-- =====================================================================

do $$ begin
  create type crm_trade_frequency as enum ('ONE_TIME','MONTHLY');
exception when duplicate_object then null; end $$;

-- Surrogate id (opportunity_id stays a plain unique 1:1 fk, not the PK)
-- so the generic tg_audit() trigger (which assumes a single `id`
-- column) can be attached — trade-detail changes must be auditable
-- per spec §40, same reasoning as crm_company_roles (0037).
create table if not exists public.crm_opportunity_trade_details (
  id                   uuid primary key default gen_random_uuid(),
  opportunity_id       uuid not null unique references public.crm_opportunities(id) on delete cascade,

  product_name         text,
  grade_specification   text,
  origin_country        text,
  destination_country   text,
  destination_port      text,

  quantity              numeric(20,4),
  unit                  text,
  packaging             text,

  incoterm              text,
  delivery_terms        text,

  target_price          numeric(20,4),
  offered_price          numeric(20,4),
  currency_code          text
    check (currency_code is null or currency_code in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  payment_terms           text,

  buyer_company_id        uuid references public.companies(id) on delete set null,
  seller_company_id       uuid references public.companies(id) on delete set null,
  buyer_contact_id         uuid references public.company_contacts(id) on delete set null,
  seller_contact_id        uuid references public.company_contacts(id) on delete set null,

  monthly_or_one_time      crm_trade_frequency,
  specification_notes       text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- tg_crm_trade_details_type_guard — a trade-details row may only exist
-- for a TRADE-typed opportunity. Can't be a plain CHECK constraint
-- since it references crm_opportunities.
-- ---------------------------------------------------------------------
create or replace function public.tg_crm_trade_details_type_guard()
returns trigger
language plpgsql
as $$
declare
  v_type crm_opportunity_type;
begin
  select opportunity_type into v_type from public.crm_opportunities where id = new.opportunity_id;
  if v_type is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_type <> 'TRADE' then
    raise exception 'TRADE_ONLY' using errcode = '22000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_trade_details_type_guard on public.crm_opportunity_trade_details;
create trigger trg_crm_trade_details_type_guard
  before insert or update on public.crm_opportunity_trade_details
  for each row execute function public.tg_crm_trade_details_type_guard();

drop trigger if exists trg_touch_crm_opportunity_trade_details on public.crm_opportunity_trade_details;
create trigger trg_touch_crm_opportunity_trade_details
  before update on public.crm_opportunity_trade_details
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_audit_crm_opportunity_trade_details on public.crm_opportunity_trade_details;
create trigger trg_audit_crm_opportunity_trade_details
  after insert or update or delete on public.crm_opportunity_trade_details
  for each row execute function public.tg_audit();

alter table public.crm_opportunity_trade_details enable row level security;

drop policy if exists p_crm_opportunity_trade_details_read   on public.crm_opportunity_trade_details;
drop policy if exists p_crm_opportunity_trade_details_write  on public.crm_opportunity_trade_details;
drop policy if exists p_crm_opportunity_trade_details_update on public.crm_opportunity_trade_details;
drop policy if exists p_crm_opportunity_trade_details_delete on public.crm_opportunity_trade_details;
create policy p_crm_opportunity_trade_details_read   on public.crm_opportunity_trade_details for select using (public.has_crm_access());
create policy p_crm_opportunity_trade_details_write  on public.crm_opportunity_trade_details for insert with check (public.can_create_crm());
create policy p_crm_opportunity_trade_details_update on public.crm_opportunity_trade_details for update using (public.can_create_crm()) with check (public.can_create_crm());
create policy p_crm_opportunity_trade_details_delete on public.crm_opportunity_trade_details for delete using (public.is_crm_admin());

grant select, insert, update, delete on public.crm_opportunity_trade_details to authenticated;

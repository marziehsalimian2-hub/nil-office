-- =====================================================================
-- NIL Office — 0101_cash_allocations_tables.sql
-- Financial Receipts & Payments — Phase 1, part 1 (schema).
--
-- New polymorphic allocation table letting one receipt/payment split
-- across multiple settlement targets (an invoice/proforma, a direct
-- contract advance, or an unapplied "on account" balance) instead of
-- the single 1:1 sales_document_id column receipts/payments already
-- have (0033_sales_document_financial_links.sql). That column is left
-- in place (forward-only: never drop a column that may hold historical
-- data) — new code just stops writing to it (see 0102 for the
-- superseding trigger, app/actions/accounting.ts for the form change).
--
-- source_kind/source_id is a polymorphic reference (no FK — mirrors
-- attachments.entity_type/entity_id) because it must point at either
-- public.receipts or public.payments. target_type/target_id is the
-- same shape for the other side: SALES_DOCUMENT -> sales_documents.id,
-- CONTRACT -> contracts.id, ON_ACCOUNT -> always null (an unapplied
-- advance with no target row yet).
--
-- CONTRACT_MILESTONE and CLIENT_SERVICE_BILLING are intentionally NOT
-- added to allocation_target_type yet — contract_payment_milestones
-- and a client-service-billing linkage don't exist as tables today.
-- The enum is deliberately left extensible (a later `alter type ...
-- add value if not exists`) rather than designed in now.
-- =====================================================================

do $$ begin
  create type public.allocation_target_type as enum ('SALES_DOCUMENT', 'CONTRACT', 'ON_ACCOUNT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cash_document_kind as enum ('RECEIPT', 'PAYMENT');
exception when duplicate_object then null; end $$;

create table if not exists public.cash_allocations (
  id           uuid primary key default gen_random_uuid(),
  source_kind  public.cash_document_kind     not null,
  source_id    uuid                          not null,
  target_type  public.allocation_target_type not null,
  target_id    uuid,
  amount       numeric(20,4) not null check (amount > 0),
  description  text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  constraint ck_cash_allocation_target check (
    (target_type = 'ON_ACCOUNT' and target_id is null) or
    (target_type <> 'ON_ACCOUNT' and target_id is not null)
  )
);

create index if not exists idx_cash_allocations_source on public.cash_allocations (source_kind, source_id);
create index if not exists idx_cash_allocations_target on public.cash_allocations (target_type, target_id);

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop table if exists public.cash_allocations;
-- drop type if exists public.cash_document_kind;
-- drop type if exists public.allocation_target_type;
-- =====================================================================

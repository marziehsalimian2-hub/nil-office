-- =====================================================================
-- NIL Office — 0087_billing_batch_tables.sql
-- Client Service Ledger — Phase 2 (Billing Integration) — schema.
--
-- A billing batch is a pure claim-aggregation container — NOT a legal
-- document (no discount/tax columns, no numbering). Converting a READY
-- batch into a real Proforma/Invoice (0089's
-- convert_billing_batch_to_sales_document) reuses the EXISTING
-- sales_documents engine untouched; a human then finishes that
-- document's own normal review/discount/tax/issue lifecycle exactly as
-- today.
--
-- Batch lines are GRANULAR, not per-entry rollups: a service_entries
-- row can contribute at most one SERVICE_ENTRY line (its own
-- service_fee) and at most one TIME_ENTRY line (its aggregated billable
-- time value) — two distinct source_type values referencing the SAME
-- source_id, so the double-billing key (source_type, source_id) never
-- collides between them. get_service_entry_claimable_amount()'s full
-- rollup (fee + time + expenses) is NOT used here — using it directly
-- would double-bill any of that entry's own expenses if they are ALSO
-- separately selected as their own EXPENSE line, which Phase 2
-- explicitly supports (expenses are billed exactly like services, not
-- deferred).
-- =====================================================================

do $$ begin
  create type billing_batch_status as enum ('DRAFT','READY','CONVERTED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_batch_source_type as enum ('SERVICE_ENTRY','TIME_ENTRY','EXPENSE','MANUAL_ADJUSTMENT');
exception when duplicate_object then null; end $$;

create table if not exists public.billing_batches (
  id                     uuid primary key default gen_random_uuid(),
  client_service_file_id uuid not null references public.client_service_files(id),
  currency               text not null default 'IRR'
                           check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  status                 billing_batch_status not null default 'DRAFT',
  period_start           date,
  period_end             date,
  total_amount           numeric(20,4) not null default 0,
  sales_document_id      uuid references public.sales_documents(id),
  created_by             uuid not null references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ck_billing_batches_period check (period_end is null or period_start is null or period_end >= period_start)
);

create index if not exists idx_billing_batches_file on public.billing_batches (client_service_file_id);
create index if not exists idx_billing_batches_status on public.billing_batches (status);
create index if not exists idx_billing_batches_sales_document on public.billing_batches (sales_document_id);

create table if not exists public.billing_batch_items (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.billing_batches(id) on delete cascade,
  source_type billing_batch_source_type not null,
  source_id   uuid, -- null only for MANUAL_ADJUSTMENT
  description text not null,
  amount      numeric(20,4) not null check (amount >= 0),
  currency    text not null check (currency in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  line_no     integer not null,
  created_at  timestamptz not null default now(),
  -- write-once snapshot, no updated_at — mirrors time_entry_internal_costs.

  constraint ck_billing_batch_items_source check (source_type = 'MANUAL_ADJUSTMENT' or source_id is not null)
);

create index if not exists idx_billing_batch_items_batch on public.billing_batch_items (batch_id);
create index if not exists idx_billing_batch_items_source on public.billing_batch_items (source_type, source_id);

do $$
declare t text;
begin
  foreach t in array array['billing_batches','billing_batch_items']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
  end loop;
end $$;

drop trigger if exists trg_touch_billing_batches on public.billing_batches;
create trigger trg_touch_billing_batches
  before update on public.billing_batches
  for each row execute function public.tg_touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['billing_batches','billing_batch_items']
  loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- Mandatory base grants (0013_table_grants.sql gotcha) — RLS (0090) does the real gating.
grant select, insert, update, delete on public.billing_batches, public.billing_batch_items to authenticated;

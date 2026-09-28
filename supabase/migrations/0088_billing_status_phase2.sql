-- =====================================================================
-- NIL Office — 0088_billing_status_phase2.sql
-- Client Service Ledger — Phase 2 — drops the Phase-1 billing_status
-- lockdown (0084's ck_service_entries_billing_status_phase1 /
-- ck_expenses_billing_status_phase1 — that migration's own comment said
-- this would happen once a billing-batch mechanism exists) and replaces
-- it with a real adjacency-guard trigger, mirroring
-- tg_sales_document_status's "a status value is only reachable via the
-- marker its own RPC/context sets atomically alongside it" idiom
-- (0031_sales_document_functions.sql:365-411).
--
-- Adjacency map (both service_entries and expenses):
--   NON_BILLABLE <-> INCLUDED <-> BILLABLE   : freely editable (manual reclassification)
--   BILLABLE -> READY_TO_BILL                 : requires can_approve_service_entry()
--   READY_TO_BILL -> BILLABLE                 : requires no ACTIVE batch item still references this row
--   BILLABLE/READY_TO_BILL -> WAIVED          : requires can_approve_service_entry() AND
--                                                waived_reason/waived_by/waived_at all set together AND
--                                                no ACTIVE batch item references this row
--   READY_TO_BILL -> INVOICED                 : requires a billing_batch_items row referencing this
--                                                exact (source_type, source_id) whose batch is already
--                                                CONVERTED (the conversion RPC flips the batch to
--                                                CONVERTED BEFORE flipping source rows, in the same
--                                                transaction, so this is always valid by then)
--   INVOICED -> READY_TO_BILL                 : the revert-on-cancel path (0089) — legal ONLY if no
--                                                billing_batch_items row referencing this row still has
--                                                a CONVERTED batch (mirrors the forward direction: the
--                                                revert trigger flips the batch away from CONVERTED
--                                                FIRST, then reverts source rows, in the same
--                                                transaction — SECURITY DEFINER does not bypass
--                                                triggers, so this guard fires for that path too and
--                                                must explicitly allow it)
--   WAIVED -> anything                        : not reachable in Phase 2
--   anything else                             : INVALID_BILLING_STATUS_TRANSITION
--
-- "ACTIVE batch item" = joined to a billing_batches row whose status is
-- not CANCELLED.
-- =====================================================================

alter table public.service_entries drop constraint if exists ck_service_entries_billing_status_phase1;
alter table public.expenses drop constraint if exists ck_expenses_billing_status_phase1;

alter table public.service_entries
  add column if not exists waived_reason text,
  add column if not exists waived_by uuid references public.profiles(id),
  add column if not exists waived_at timestamptz;

alter table public.expenses
  add column if not exists waived_reason text,
  add column if not exists waived_by uuid references public.profiles(id),
  add column if not exists waived_at timestamptz;

create or replace function public.tg_service_entry_billing_status_guard()
returns trigger
language plpgsql
as $$
begin
  if new.billing_status is not distinct from old.billing_status then
    return new;
  end if;

  if old.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE')
     and new.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE') then
    return new;
  end if;

  if old.billing_status = 'BILLABLE' and new.billing_status = 'READY_TO_BILL' then
    if not public.can_approve_service_entry() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.billing_status = 'READY_TO_BILL' and new.billing_status = 'BILLABLE' then
    if exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type = 'SERVICE_ENTRY' and bi.source_id = old.id and bb.status <> 'CANCELLED'
    ) then
      raise exception 'REMOVE_FROM_BATCH_FIRST' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status in ('BILLABLE','READY_TO_BILL') and new.billing_status = 'WAIVED' then
    if not public.can_approve_service_entry() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    if new.waived_reason is null or new.waived_by is null or new.waived_at is null then
      raise exception 'WAIVE_REQUIRES_REASON' using errcode = '22000';
    end if;
    if exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type in ('SERVICE_ENTRY','TIME_ENTRY') and bi.source_id = old.id and bb.status <> 'CANCELLED'
    ) then
      raise exception 'REMOVE_FROM_BATCH_FIRST' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status = 'READY_TO_BILL' and new.billing_status = 'INVOICED' then
    if not exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type in ('SERVICE_ENTRY','TIME_ENTRY') and bi.source_id = old.id and bb.status = 'CONVERTED'
    ) then
      raise exception 'USE_BILLING_BATCH_TO_INVOICE' using errcode = '22000';
    end if;
    return new;
  end if;

  -- Revert-on-cancel path (0089's tg_billing_batch_revert_on_cancel) — legal
  -- only once the referencing batch is no longer CONVERTED (that trigger
  -- flips the batch first, in the same transaction).
  if old.billing_status = 'INVOICED' and new.billing_status = 'READY_TO_BILL' then
    if exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type in ('SERVICE_ENTRY','TIME_ENTRY') and bi.source_id = old.id and bb.status = 'CONVERTED'
    ) then
      raise exception 'BATCH_STILL_CONVERTED' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status in ('INVOICED','WAIVED') then
    raise exception 'TERMINAL_BILLING_STATUS' using errcode = '22000';
  end if;

  raise exception 'INVALID_BILLING_STATUS_TRANSITION' using errcode = '22000';
end;
$$;

drop trigger if exists trg_service_entry_billing_status_guard on public.service_entries;
create trigger trg_service_entry_billing_status_guard
  before update on public.service_entries
  for each row execute function public.tg_service_entry_billing_status_guard();

create or replace function public.tg_expense_billing_status_guard()
returns trigger
language plpgsql
as $$
begin
  if new.billing_status is not distinct from old.billing_status then
    return new;
  end if;

  if old.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE')
     and new.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE') then
    return new;
  end if;

  if old.billing_status = 'BILLABLE' and new.billing_status = 'READY_TO_BILL' then
    if not public.can_approve_service_entry() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.billing_status = 'READY_TO_BILL' and new.billing_status = 'BILLABLE' then
    if exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type = 'EXPENSE' and bi.source_id = old.id and bb.status <> 'CANCELLED'
    ) then
      raise exception 'REMOVE_FROM_BATCH_FIRST' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status in ('BILLABLE','READY_TO_BILL') and new.billing_status = 'WAIVED' then
    if not public.can_approve_service_entry() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    if new.waived_reason is null or new.waived_by is null or new.waived_at is null then
      raise exception 'WAIVE_REQUIRES_REASON' using errcode = '22000';
    end if;
    if exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type = 'EXPENSE' and bi.source_id = old.id and bb.status <> 'CANCELLED'
    ) then
      raise exception 'REMOVE_FROM_BATCH_FIRST' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status = 'READY_TO_BILL' and new.billing_status = 'INVOICED' then
    if not exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type = 'EXPENSE' and bi.source_id = old.id and bb.status = 'CONVERTED'
    ) then
      raise exception 'USE_BILLING_BATCH_TO_INVOICE' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status = 'INVOICED' and new.billing_status = 'READY_TO_BILL' then
    if exists (
      select 1 from public.billing_batch_items bi
      join public.billing_batches bb on bb.id = bi.batch_id
      where bi.source_type = 'EXPENSE' and bi.source_id = old.id and bb.status = 'CONVERTED'
    ) then
      raise exception 'BATCH_STILL_CONVERTED' using errcode = '22000';
    end if;
    return new;
  end if;

  if old.billing_status in ('INVOICED','WAIVED') then
    raise exception 'TERMINAL_BILLING_STATUS' using errcode = '22000';
  end if;

  raise exception 'INVALID_BILLING_STATUS_TRANSITION' using errcode = '22000';
end;
$$;

drop trigger if exists trg_expense_billing_status_guard on public.expenses;
create trigger trg_expense_billing_status_guard
  before update on public.expenses
  for each row execute function public.tg_expense_billing_status_guard();

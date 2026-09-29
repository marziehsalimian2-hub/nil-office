-- =====================================================================
-- NIL Office — 0091_billing_status_ready_fix.sql
-- Client Service Ledger — Phase 2 — live-tested fix (2026-09-28).
--
-- Bug: tg_service_entry_billing_status_guard/tg_expense_billing_status_guard
-- (0088) only allowed BILLABLE -> READY_TO_BILL. But every newly created
-- service_entries/expenses row defaults to billing_status='NON_BILLABLE'
-- (0084), and there is no UI step anywhere that transitions it to
-- BILLABLE first — the "علامت‌گذاری به‌عنوان آمادهٔ صورتحساب" bulk action
-- (bulkMarkServiceEntriesReadyToBill/bulkMarkServiceExpensesReadyToBill,
-- app/actions/service-{entries,expenses}.ts) tries NON_BILLABLE ->
-- READY_TO_BILL directly, which the guard trigger rejected with
-- INVALID_BILLING_STATUS_TRANSITION every time.
--
-- Fix: widen the "-> READY_TO_BILL" branch to accept any of
-- NON_BILLABLE/INCLUDED/BILLABLE as the starting point (all still require
-- can_approve_service_entry() — the authorization bar is unchanged, only
-- the set of legal starting states was too narrow). Forward migration,
-- not an edit to 0088 — create or replace on the same function names,
-- same convention finalize_sales_document/format_display_number etc.
-- already use across this codebase's own migration history.
-- =====================================================================

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

  if old.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE') and new.billing_status = 'READY_TO_BILL' then
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

  if old.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE','READY_TO_BILL') and new.billing_status = 'WAIVED' then
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

  if old.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE') and new.billing_status = 'READY_TO_BILL' then
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

  if old.billing_status in ('NON_BILLABLE','INCLUDED','BILLABLE','READY_TO_BILL') and new.billing_status = 'WAIVED' then
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

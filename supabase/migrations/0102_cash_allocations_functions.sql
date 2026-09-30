-- =====================================================================
-- NIL Office — 0102_cash_allocations_functions.sql
-- Financial Receipts & Payments — Phase 1, part 2 (allocation engine +
-- settlement recompute).
--
-- Supersedes 0064_sales_document_settlement_trigger.sql's
-- tg_receipt_sales_document_settlement(), which read the single
-- receipts.sales_document_id column. That trigger is dropped below; its
-- function is left defined but now unreferenced (harmless dead code —
-- same "leaving the extra branch in place is harmless" reasoning
-- 0074's own rollback note already uses).
--
-- Two thin trigger functions funnel into one shared worker
-- (_recompute_sales_document_settlement) — Postgres triggers can't
-- share one body across two different firing tables directly, so each
-- gets its own wrapper:
--   trg_cash_allocation_settlement  (on cash_allocations, AFTER I/U/D)
--     fires the moment an allocation is created/edited/removed.
--   trg_receipt_status_settlement   (on receipts, AFTER UPDATE)
--     fires the moment a receipt transitions to/from POSTED, because a
--     DRAFT receipt can already carry allocations set before
--     post_receipt() ever runs — the recompute worker only counts
--     POSTED receipts, so the allocation-side trigger alone would see
--     zero effective amount while still DRAFT.
--
-- Only RECEIPT-sourced allocations move sales_document status — same
-- receipts-only asymmetry 0064 already documented ("an invoice is
-- settled by money coming IN, never by NIL paying someone out").
-- CONTRACT targets get no persisted status escalation (contracts have
-- no settlement-status field); they only get the over-allocation
-- ceiling check inside set_cash_allocations below.
-- =====================================================================

drop trigger if exists trg_receipt_sales_document_settlement on public.receipts;
-- tg_receipt_sales_document_settlement() itself is left in place,
-- unreferenced, per this codebase's forward-only convention.

create or replace function public._recompute_sales_document_settlement(p_sales_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc      public.sales_documents;
  v_received numeric(20,4);
begin
  select * into v_doc from public.sales_documents where id = p_sales_document_id;
  if not found or v_doc.type <> 'INVOICE' then
    return;
  end if;

  select coalesce(sum(a.amount), 0) into v_received
    from public.cash_allocations a
    join public.receipts r on r.id = a.source_id
   where a.source_kind = 'RECEIPT'
     and a.target_type = 'SALES_DOCUMENT'
     and a.target_id   = p_sales_document_id
     and r.status       = 'POSTED';

  if v_received >= v_doc.total_amount and v_doc.status in ('ISSUED', 'PARTIALLY_SETTLED', 'OVERDUE') then
    update public.sales_documents set status = 'SETTLED', updated_at = now() where id = p_sales_document_id;
  elsif v_received > 0 and v_doc.status = 'ISSUED' then
    update public.sales_documents set status = 'PARTIALLY_SETTLED', updated_at = now() where id = p_sales_document_id;
  end if;
end;
$$;
revoke execute on function public._recompute_sales_document_settlement(uuid) from public, anon, authenticated;

create or replace function public.tg_cash_allocation_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_type public.allocation_target_type;
  v_source_kind public.cash_document_kind;
  v_target_id   uuid;
begin
  v_target_type := coalesce(new.target_type, old.target_type);
  v_source_kind := coalesce(new.source_kind, old.source_kind);
  v_target_id   := coalesce(new.target_id, old.target_id);

  if v_target_type = 'SALES_DOCUMENT' and v_source_kind = 'RECEIPT' and v_target_id is not null then
    perform public._recompute_sales_document_settlement(v_target_id);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_cash_allocation_settlement on public.cash_allocations;
create trigger trg_cash_allocation_settlement
  after insert or update or delete on public.cash_allocations
  for each row execute function public.tg_cash_allocation_settlement();

create or replace function public.tg_receipt_status_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_target record;
begin
  if new.status is distinct from old.status and (new.status = 'POSTED' or old.status = 'POSTED') then
    for v_target in
      select distinct target_id from public.cash_allocations
       where source_kind = 'RECEIPT' and source_id = new.id and target_type = 'SALES_DOCUMENT'
    loop
      perform public._recompute_sales_document_settlement(v_target.target_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receipt_status_settlement on public.receipts;
create trigger trg_receipt_status_settlement
  after update on public.receipts
  for each row execute function public.tg_receipt_status_settlement();

-- ---------------------------------------------------------------------
-- set_cash_allocations — the ONLY way allocation rows are ever written.
-- Replaces the full allocation set for one receipt/payment atomically:
-- delete-then-reinsert under a row lock on the source document, so two
-- concurrent calls against the SAME source serialise and the
-- over-allocation sums computed inside the loop always see a
-- consistent snapshot.
--
-- Rules enforced this phase:
--   * allocation amount > 0 (also a table CHECK, belt-and-braces)
--   * sum of this source's own allocations never exceeds its amount
--   * sum of ALL allocations against one SALES_DOCUMENT/CONTRACT target
--     never exceeds that target's own total_amount, checked separately
--     per (target_type, target_id, source_kind) — a receipt (money in)
--     and a payment (money out) against the same invoice/contract are
--     independent, not one pool to net against each other.
--   * only while the source document is still DRAFT.
-- No credit-note override in this phase: over-settlement is a hard
-- error, full stop.
-- ---------------------------------------------------------------------
create or replace function public.set_cash_allocations(
  p_source_kind text,
  p_source_id   uuid,
  p_allocations jsonb
)
returns setof public.cash_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_amount    numeric(20,4);
  v_source_status    posting_status;
  v_kind             public.cash_document_kind;
  v_alloc            jsonb;
  v_target_type      text;
  v_target_id        uuid;
  v_amount           numeric(20,4);
  v_sum_source       numeric(20,4) := 0;
  v_target_total     numeric(20,4);
  v_target_allocated numeric(20,4);
begin
  if not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_source_kind not in ('RECEIPT', 'PAYMENT') then
    raise exception 'INVALID_SOURCE_KIND' using errcode = '22000';
  end if;
  v_kind := p_source_kind::public.cash_document_kind;

  if v_kind = 'RECEIPT' then
    select amount, status into v_source_amount, v_source_status from public.receipts where id = p_source_id for update;
  else
    select amount, status into v_source_amount, v_source_status from public.payments where id = p_source_id for update;
  end if;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_source_status <> 'DRAFT' then raise exception 'CASH_DOC_NOT_DRAFT' using errcode = '22000'; end if;

  delete from public.cash_allocations where source_kind = v_kind and source_id = p_source_id;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_target_type := v_alloc ->> 'target_type';
    v_target_id   := nullif(v_alloc ->> 'target_id', '')::uuid;
    v_amount      := (v_alloc ->> 'amount')::numeric;

    if v_target_type not in ('SALES_DOCUMENT', 'CONTRACT', 'ON_ACCOUNT') then
      raise exception 'INVALID_TARGET_TYPE' using errcode = '22000';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'INVALID_ALLOCATION_AMOUNT' using errcode = '22000';
    end if;
    if v_target_type = 'ON_ACCOUNT' and v_target_id is not null then
      raise exception 'ALLOCATION_ON_ACCOUNT_NO_TARGET' using errcode = '22000';
    end if;
    if v_target_type <> 'ON_ACCOUNT' and v_target_id is null then
      raise exception 'ALLOCATION_TARGET_REQUIRED' using errcode = '22000';
    end if;

    v_sum_source := v_sum_source + v_amount;

    if v_target_type = 'SALES_DOCUMENT' then
      select total_amount into v_target_total from public.sales_documents where id = v_target_id;
      if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    elsif v_target_type = 'CONTRACT' then
      select total_amount into v_target_total from public.contracts where id = v_target_id;
      if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    end if;

    if v_target_type in ('SALES_DOCUMENT', 'CONTRACT') then
      select coalesce(sum(amount), 0) into v_target_allocated
        from public.cash_allocations
       where target_type = v_target_type::public.allocation_target_type
         and target_id   = v_target_id
         and source_kind = v_kind;
      if v_target_allocated + v_amount > v_target_total then
        raise exception 'TARGET_OVER_ALLOCATED' using errcode = '22000';
      end if;
    end if;

    insert into public.cash_allocations (source_kind, source_id, target_type, target_id, amount, description, created_by)
    values (v_kind, p_source_id, v_target_type::public.allocation_target_type, v_target_id, v_amount,
            v_alloc ->> 'description', auth.uid());
  end loop;

  if v_sum_source > v_source_amount then
    raise exception 'SOURCE_OVER_ALLOCATED' using errcode = '22000';
  end if;

  perform public.write_log(lower(p_source_kind), p_source_id, 'ALLOCATIONS_SET', null,
    jsonb_build_object('count', jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)), 'total', v_sum_source));

  return query select * from public.cash_allocations where source_kind = v_kind and source_id = p_source_id;
end;
$$;

grant execute on function public.set_cash_allocations(text, uuid, jsonb) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.set_cash_allocations(text, uuid, jsonb);
-- drop trigger if exists trg_receipt_status_settlement on public.receipts;
-- drop function if exists public.tg_receipt_status_settlement();
-- drop trigger if exists trg_cash_allocation_settlement on public.cash_allocations;
-- drop function if exists public.tg_cash_allocation_settlement();
-- drop function if exists public._recompute_sales_document_settlement(uuid);
-- create trigger trg_receipt_sales_document_settlement after insert or update
--   on public.receipts for each row execute function public.tg_receipt_sales_document_settlement();
-- =====================================================================

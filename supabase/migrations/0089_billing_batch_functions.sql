-- =====================================================================
-- NIL Office — 0089_billing_batch_functions.sql
-- Client Service Ledger — Phase 2 — rollup, double-billing guard, batch
-- status adjacency, conversion RPC, revert-on-cancel.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Item rollup — total_amount is maintained ONLY here, mirrors
-- tg_sales_document_items_rollup (0031) exactly.
-- ---------------------------------------------------------------------
create or replace function public.tg_billing_batch_items_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_total    numeric(20,4);
begin
  v_batch_id := coalesce(new.batch_id, old.batch_id);

  select coalesce(sum(amount), 0) into v_total
    from public.billing_batch_items
   where batch_id = v_batch_id;

  update public.billing_batches
     set total_amount = v_total,
         updated_at   = now()
   where id = v_batch_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_billing_batch_items_rollup on public.billing_batch_items;
create trigger trg_billing_batch_items_rollup
  after insert or update or delete on public.billing_batch_items
  for each row execute function public.tg_billing_batch_items_rollup();

-- ---------------------------------------------------------------------
-- Double-billing / currency-mismatch / editability guard.
-- ---------------------------------------------------------------------
create or replace function public.tg_billing_batch_item_guard()
returns trigger
language plpgsql
as $$
declare
  v_batch public.billing_batches;
begin
  select * into v_batch from public.billing_batches where id = new.batch_id;
  if not found then
    raise exception 'BATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_batch.status <> 'DRAFT' then
    raise exception 'BATCH_NOT_EDITABLE' using errcode = '22000';
  end if;

  if new.currency <> v_batch.currency then
    raise exception 'CURRENCY_MISMATCH' using errcode = '22000';
  end if;

  if new.source_id is not null and exists (
    select 1 from public.billing_batch_items bi
    join public.billing_batches bb on bb.id = bi.batch_id
    where bi.source_type = new.source_type
      and bi.source_id = new.source_id
      and bb.status <> 'CANCELLED'
  ) then
    raise exception 'DOUBLE_BILLING' using errcode = '22000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_billing_batch_item_guard on public.billing_batch_items;
create trigger trg_billing_batch_item_guard
  before insert on public.billing_batch_items
  for each row execute function public.tg_billing_batch_item_guard();

-- ---------------------------------------------------------------------
-- Batch status adjacency — CONVERTED only reachable via the RPC's own
-- atomic marker (sales_document_id), exact copy of
-- tg_sales_document_status's ISSUED/CONVERTED special-case idiom.
-- ---------------------------------------------------------------------
create or replace function public.tg_billing_batch_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then

    if new.status = 'CONVERTED' then
      if old.sales_document_id is null and new.sales_document_id is not null then
        return new; -- legitimate flip by convert_billing_batch_to_sales_document
      end if;
      raise exception 'USE_RPC_TO_CONVERT' using errcode = '22000';
    end if;

    -- Revert-on-cancel (0089's tg_billing_batch_revert_on_cancel) flips
    -- CONVERTED -> READY as a system side-effect of the RESULTING
    -- sales_document being cancelled (already gated by that document's
    -- own can_approve_invoice() check) — the acting user need not hold
    -- service-ledger approve rights themselves, so this path is exempt
    -- from the can_approve_service_entry() check below.
    if old.status = 'CONVERTED' and new.status = 'READY' then
      return new;
    end if;

    if not (
      (old.status = 'DRAFT' and new.status in ('READY','CANCELLED')) or
      (old.status = 'READY' and new.status in ('DRAFT','CANCELLED'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
    end if;

    if not public.can_approve_service_entry() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_billing_batch_status on public.billing_batches;
create trigger trg_billing_batch_status
  before update on public.billing_batches
  for each row execute function public.tg_billing_batch_status();

-- ---------------------------------------------------------------------
-- convert_billing_batch_to_sales_document — the ONE bridge into the
-- existing invoice engine. Leaves the new sales_document at DRAFT for a
-- human to review/discount/tax/issue through the EXISTING lifecycle
-- (setSalesDocumentStatus / finalize_sales_document) — never bypassed
-- or duplicated here.
-- ---------------------------------------------------------------------
create or replace function public.convert_billing_batch_to_sales_document(
  p_batch_id uuid,
  p_type     text default 'INVOICE'
)
returns public.sales_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch   public.billing_batches;
  v_file    public.client_service_files;
  v_company public.companies;
  v_new_id  uuid;
  v_new     public.sales_documents;
  v_item    record;
  v_line_no int := 0;
begin
  if not (public.can_approve_service_entry() and public.can_create_invoice()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_type not in ('PROFORMA','INVOICE') then
    raise exception 'INVALID_TYPE' using errcode = '22000';
  end if;

  select * into v_batch from public.billing_batches where id = p_batch_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_batch.status <> 'READY' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  select * into v_file from public.client_service_files where id = v_batch.client_service_file_id;
  select * into v_company from public.companies where id = v_file.company_id;
  if not found then
    raise exception 'COMPANY_NOT_FOUND' using errcode = '22000';
  end if;

  -- Defensive re-check: every item's source row must still be eligible
  -- (READY_TO_BILL), even though the insert-time trigger already guarded
  -- against double-booking — a manual reversion could theoretically race
  -- between adding the item and converting the batch.
  for v_item in select * from public.billing_batch_items where batch_id = p_batch_id loop
    if v_item.source_type in ('SERVICE_ENTRY','TIME_ENTRY') then
      if not exists (select 1 from public.service_entries where id = v_item.source_id and billing_status = 'READY_TO_BILL') then
        raise exception 'ITEM_NO_LONGER_ELIGIBLE' using errcode = '22000';
      end if;
    elsif v_item.source_type = 'EXPENSE' then
      if not exists (select 1 from public.expenses where id = v_item.source_id and billing_status = 'READY_TO_BILL') then
        raise exception 'ITEM_NO_LONGER_ELIGIBLE' using errcode = '22000';
      end if;
    end if;
  end loop;

  insert into public.sales_documents (
    type, status, company_id, currency_code,
    customer_legal_name_snapshot, customer_english_name_snapshot,
    customer_contact_person_snapshot, customer_email_snapshot,
    customer_phone_snapshot, customer_address_snapshot,
    created_by
  )
  values (
    p_type::sales_document_type, 'DRAFT', v_file.company_id, v_batch.currency,
    v_company.legal_name, v_company.english_name,
    v_company.contact_person, v_company.email,
    v_company.phone, v_company.address,
    auth.uid()
  )
  returning id into v_new_id;

  for v_item in select * from public.billing_batch_items where batch_id = p_batch_id order by line_no loop
    v_line_no := v_line_no + 1;
    insert into public.sales_document_items (
      sales_document_id, line_no, item_type, description, quantity, unit_price
    ) values (
      v_new_id, v_line_no, 'SERVICE', v_item.description, 1, v_item.amount
    );
  end loop;

  update public.billing_batches
     set status = 'CONVERTED', sales_document_id = v_new_id, updated_at = now()
   where id = p_batch_id;

  update public.service_entries
     set billing_status = 'INVOICED'
   where id in (
     select source_id from public.billing_batch_items
      where batch_id = p_batch_id and source_type in ('SERVICE_ENTRY','TIME_ENTRY')
   );

  update public.expenses
     set billing_status = 'INVOICED'
   where id in (
     select source_id from public.billing_batch_items
      where batch_id = p_batch_id and source_type = 'EXPENSE'
   );

  perform public.write_log(
    'billing_batches', p_batch_id, 'CONVERTED',
    jsonb_build_object('status', 'READY'),
    jsonb_build_object('status', 'CONVERTED', 'sales_document_id', v_new_id)
  );
  perform public.write_log(
    'sales_documents', v_new_id, 'CREATED_FROM_BILLING_BATCH',
    null, jsonb_build_object('billing_batch_id', p_batch_id)
  );

  select * into v_new from public.sales_documents where id = v_new_id;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------
-- Revert on cancel — if a batch-originated sales_document is CANCELLED
-- before ever being issued, un-invoice everything it claimed.
-- ---------------------------------------------------------------------
create or replace function public.tg_billing_batch_revert_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.billing_batches;
begin
  if new.status <> 'CANCELLED' or old.status = 'CANCELLED' then
    return new;
  end if;

  select * into v_batch from public.billing_batches where sales_document_id = new.id and status = 'CONVERTED';
  if not found then
    return new;
  end if;

  update public.billing_batches
     set status = 'READY', sales_document_id = null, updated_at = now()
   where id = v_batch.id;

  update public.service_entries
     set billing_status = 'READY_TO_BILL'
   where id in (
     select source_id from public.billing_batch_items
      where batch_id = v_batch.id and source_type in ('SERVICE_ENTRY','TIME_ENTRY')
   );

  update public.expenses
     set billing_status = 'READY_TO_BILL'
   where id in (
     select source_id from public.billing_batch_items
      where batch_id = v_batch.id and source_type = 'EXPENSE'
   );

  perform public.write_log(
    'billing_batches', v_batch.id, 'REVERTED_ON_CANCEL',
    jsonb_build_object('status', 'CONVERTED', 'sales_document_id', new.id),
    jsonb_build_object('status', 'READY', 'sales_document_id', null)
  );

  return new;
end;
$$;

drop trigger if exists trg_billing_batch_revert_on_cancel on public.sales_documents;
create trigger trg_billing_batch_revert_on_cancel
  after update on public.sales_documents
  for each row execute function public.tg_billing_batch_revert_on_cancel();

grant execute on function public.convert_billing_batch_to_sales_document(uuid, text) to authenticated;

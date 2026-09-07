-- =====================================================================
-- NIL Office — 0064_sales_document_settlement_trigger.sql
-- Invoice Phase 3 — auto-derive PARTIALLY_SETTLED/SETTLED from posted
-- receipts. Only ever escalates, never de-escalates, and treats
-- SETTLED as terminal — this matches exactly what
-- tg_sales_document_status's existing adjacency map already permits
-- (0031_sales_document_functions.sql has no de-escalation branch at
-- all), so this trigger can never trigger an INVALID_STATUS_TRANSITION
-- from inside a receipt save. If receipts are later reversed after
-- SETTLED, that needs a human correction via the existing
-- setSalesDocumentStatus action — deliberately not automated here.
--
-- Receipts only (not payments) — an invoice is settled by money coming
-- IN, never by NIL paying someone out.
-- =====================================================================

create or replace function public.tg_receipt_sales_document_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_document_id uuid;
  v_doc public.sales_documents;
  v_received numeric(20,4);
begin
  v_sales_document_id := coalesce(new.sales_document_id, old.sales_document_id);
  if v_sales_document_id is null then
    return coalesce(new, old);
  end if;

  select * into v_doc from public.sales_documents where id = v_sales_document_id;
  if not found or v_doc.type <> 'INVOICE' then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount), 0) into v_received
    from public.receipts
   where sales_document_id = v_sales_document_id and status = 'POSTED';

  if v_received >= v_doc.total_amount and v_doc.status in ('ISSUED', 'PARTIALLY_SETTLED', 'OVERDUE') then
    update public.sales_documents set status = 'SETTLED', updated_at = now() where id = v_sales_document_id;
  elsif v_received > 0 and v_doc.status = 'ISSUED' then
    update public.sales_documents set status = 'PARTIALLY_SETTLED', updated_at = now() where id = v_sales_document_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_receipt_sales_document_settlement on public.receipts;
create trigger trg_receipt_sales_document_settlement
  after insert or update on public.receipts
  for each row execute function public.tg_receipt_sales_document_settlement();

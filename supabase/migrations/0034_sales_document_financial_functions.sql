-- =====================================================================
-- NIL Office — 0034_sales_document_financial_functions.sql
-- Invoice/Proforma module — Phase 1 (financial integration).
--
-- receipts/payments/journal_entry_lines are only SELECT-able by users
-- with accounting_role set (has_accounting_access(), 0009_accounting_
-- rls.sql). An invoice-only user (invoice_role set, accounting_role
-- null) gets zero rows from those tables directly, including their own
-- invoice's data — mirrors the exact gap get_contract_financial_activity
-- (0028_contract_financial_functions.sql) already bridges for contracts.
-- These two SECURITY DEFINER functions do the same for sales_documents,
-- gated on has_invoice_access() instead of has_accounting_access().
-- Only status='POSTED' rows are ever returned.
--
-- NOTE: column aliases on the FIRST branch of each UNION ALL are
-- required — Postgres names a UNION's output columns after the first
-- branch's expressions, and r.receipt_date/p.payment_date would
-- otherwise be inferred as "receipt_date"/"payment_date" instead of
-- "document_date", breaking the trailing ORDER BY (this broke
-- 0028_contract_financial_functions.sql on first try; fixed proactively
-- here from the start).
-- =====================================================================

create or replace function public.get_sales_document_financial_activity(p_sales_document_id uuid)
returns table (
  source           text,
  id               uuid,
  document_date    date,
  document_number  text,
  description      text,
  amount           numeric(20,4),
  direction        text,
  status           posting_status,
  currency_code    text,
  journal_entry_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    'RECEIPT' as source, r.id, r.receipt_date as document_date, je.document_number,
    r.description, r.amount, 'IN' as direction, r.status, r.currency_code, r.journal_entry_id
    from public.receipts r
    left join public.journal_entries je on je.id = r.journal_entry_id
   where r.sales_document_id = p_sales_document_id and r.status = 'POSTED' and public.has_invoice_access()
  union all
  select
    'PAYMENT' as source, p.id, p.payment_date as document_date, je.document_number,
    p.description, p.amount, 'OUT' as direction, p.status, p.currency_code, p.journal_entry_id
    from public.payments p
    left join public.journal_entries je on je.id = p.journal_entry_id
   where p.sales_document_id = p_sales_document_id and p.status = 'POSTED' and public.has_invoice_access()
  union all
  select
    'JOURNAL_LINE' as source, l.id, e.document_date, e.document_number, l.description,
    greatest(l.debit, l.credit) as amount,
    case when l.debit > 0 then 'IN' else 'OUT' end as direction,
    e.status, l.currency_code, e.id as journal_entry_id
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
   where l.sales_document_id = p_sales_document_id and e.status = 'POSTED' and public.has_invoice_access()
  order by document_date desc;
$$;

create or replace function public.get_sales_document_financial_summary(p_sales_document_id uuid)
returns table (
  received_amount  numeric(20,4),
  remaining_amount numeric(20,4)
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select sum(r.amount) from public.receipts r where r.sales_document_id = p_sales_document_id and r.status = 'POSTED'), 0),
    sd.total_amount - coalesce((select sum(r.amount) from public.receipts r where r.sales_document_id = p_sales_document_id and r.status = 'POSTED'), 0)
  from public.sales_documents sd
  where sd.id = p_sales_document_id and public.has_invoice_access();
$$;

grant execute on function public.get_sales_document_financial_activity(uuid) to authenticated;
grant execute on function public.get_sales_document_financial_summary(uuid)  to authenticated;

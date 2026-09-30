-- =====================================================================
-- NIL Office — 0105_company_financial_functions.sql
-- Financial Receipts & Payments — Phase 2, part 1 (company-level
-- financial summary/activity).
--
-- Company-level counterpart to get_contract_financial_summary/activity
-- (0028_contract_financial_functions.sql): same SECURITY DEFINER +
-- has_contract_access() bridge (the established precedent for letting a
-- non-accounting-role user read a POSTED-only receipts/payments rollup
-- from a non-accounting detail page — the contract page has no extra
-- page-level role gate on its financial tab either, the RPC's own gate
-- IS the access control), just scoped by company_id instead of
-- contract_id. receipts/payments.company_id already exists (0007).
--
-- Unlike a contract, a company has no single total_amount to net
-- against received_amount, so "outstanding" here means something
-- different: the unsettled portion of this company's own issued
-- invoices (type='INVOICE', status in ('ISSUED','PARTIALLY_SETTLED',
-- 'OVERDUE') — the exact status set _recompute_sales_document_settlement
-- (0102) treats as "still settling"), each invoice's own total_amount
-- minus whatever POSTED-receipt cash_allocations have already been
-- applied to it. This reuses Phase 1's cash_allocations table directly
-- rather than re-deriving settlement math — it does NOT touch
-- sales_documents.status (that's still owned exclusively by
-- _recompute_sales_document_settlement's trigger chain).
-- =====================================================================

create or replace function public.get_company_financial_summary(p_company_id uuid)
returns table (
  currency_code                text,
  received_amount              numeric(20,4),
  paid_amount                  numeric(20,4),
  outstanding_invoices_amount  numeric(20,4)
)
language sql
stable
security definer
set search_path = public
as $$
  with received_by_currency as (
    select r.currency_code, coalesce(sum(r.amount), 0) as amount
      from public.receipts r
     where r.company_id = p_company_id and r.status = 'POSTED'
     group by r.currency_code
  ),
  paid_by_currency as (
    select p.currency_code, coalesce(sum(p.amount), 0) as amount
      from public.payments p
     where p.company_id = p_company_id and p.status = 'POSTED'
     group by p.currency_code
  ),
  allocated_by_sales_document as (
    select ca.target_id as sales_document_id, coalesce(sum(ca.amount), 0) as amount
      from public.cash_allocations ca
      join public.receipts r on r.id = ca.source_id
     where ca.source_kind = 'RECEIPT' and ca.target_type = 'SALES_DOCUMENT' and r.status = 'POSTED'
     group by ca.target_id
  ),
  outstanding_by_currency as (
    select sd.currency_code, coalesce(sum(sd.total_amount - coalesce(al.amount, 0)), 0) as amount
      from public.sales_documents sd
      left join allocated_by_sales_document al on al.sales_document_id = sd.id
     where sd.company_id = p_company_id
       and sd.type = 'INVOICE'
       and sd.status in ('ISSUED', 'PARTIALLY_SETTLED', 'OVERDUE')
     group by sd.currency_code
  ),
  currencies as (
    select currency_code from received_by_currency
    union select currency_code from paid_by_currency
    union select currency_code from outstanding_by_currency
  )
  select
    c.currency_code,
    coalesce(rc.amount, 0) as received_amount,
    coalesce(pd.amount, 0) as paid_amount,
    coalesce(os.amount, 0) as outstanding_invoices_amount
  from currencies c
  left join received_by_currency rc on rc.currency_code = c.currency_code
  left join paid_by_currency pd on pd.currency_code = c.currency_code
  left join outstanding_by_currency os on os.currency_code = c.currency_code
  where public.has_contract_access();
$$;

create or replace function public.get_company_financial_activity(p_company_id uuid)
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
   where r.company_id = p_company_id and r.status = 'POSTED' and public.has_contract_access()
  union all
  select
    'PAYMENT' as source, p.id, p.payment_date as document_date, je.document_number,
    p.description, p.amount, 'OUT' as direction, p.status, p.currency_code, p.journal_entry_id
    from public.payments p
    left join public.journal_entries je on je.id = p.journal_entry_id
   where p.company_id = p_company_id and p.status = 'POSTED' and public.has_contract_access()
  union all
  select
    'JOURNAL_LINE' as source, l.id, e.document_date, e.document_number, l.description,
    greatest(l.debit, l.credit) as amount,
    case when l.debit > 0 then 'IN' else 'OUT' end as direction,
    e.status, l.currency_code, e.id as journal_entry_id
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
   where l.company_id = p_company_id and e.status = 'POSTED' and public.has_contract_access()
  order by document_date desc;
$$;

grant execute on function public.get_company_financial_summary(uuid)  to authenticated;
grant execute on function public.get_company_financial_activity(uuid) to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.get_company_financial_summary(uuid);
-- drop function if exists public.get_company_financial_activity(uuid);
-- =====================================================================

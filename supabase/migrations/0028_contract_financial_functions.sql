-- =====================================================================
-- NIL Office — 0028_contract_financial_functions.sql
-- Contract Management module — Phase 3 (financial integration), part 2.
--
-- receipts/payments/journal_entry_lines are only SELECT-able by users
-- with accounting_role set (has_accounting_access(), 0009_accounting_rls.sql).
-- A contract-only user (contract_role set, accounting_role null) gets
-- zero rows from those tables directly, including their own contract's
-- data — v_posted_lines doesn't help either, since it's security_invoker
-- and therefore still subject to the caller's own RLS.
--
-- These two SECURITY DEFINER functions bridge that gap: gated on
-- has_contract_access() instead of has_accounting_access(), same pattern
-- every existing accounting RPC (post_receipt, post_journal_entry, ...)
-- already uses to operate beyond the caller's row-level privileges.
-- Only status='POSTED' rows are ever returned — a DRAFT receipt/payment
-- linked to a contract must never look like real money movement (spec
-- §9: no second accounting truth).
-- =====================================================================

create or replace function public.get_contract_financial_activity(p_contract_id uuid)
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
  -- Column aliases on the first branch are required: Postgres names a
  -- UNION's output columns after the FIRST select's expressions, and
  -- r.receipt_date/p.payment_date would otherwise be inferred as
  -- "receipt_date"/"payment_date" instead of "document_date", breaking
  -- the ORDER BY below (and the RETURNS TABLE column mapping is
  -- positional, so the alias here only affects readability/ORDER BY,
  -- not correctness of what the caller receives).
  select
    'RECEIPT' as source, r.id, r.receipt_date as document_date, je.document_number,
    r.description, r.amount, 'IN' as direction, r.status, r.currency_code, r.journal_entry_id
    from public.receipts r
    left join public.journal_entries je on je.id = r.journal_entry_id
   where r.contract_id = p_contract_id and r.status = 'POSTED' and public.has_contract_access()
  union all
  select
    'PAYMENT' as source, p.id, p.payment_date as document_date, je.document_number,
    p.description, p.amount, 'OUT' as direction, p.status, p.currency_code, p.journal_entry_id
    from public.payments p
    left join public.journal_entries je on je.id = p.journal_entry_id
   where p.contract_id = p_contract_id and p.status = 'POSTED' and public.has_contract_access()
  union all
  select
    'JOURNAL_LINE' as source, l.id, e.document_date, e.document_number, l.description,
    greatest(l.debit, l.credit) as amount,
    case when l.debit > 0 then 'IN' else 'OUT' end as direction,
    e.status, l.currency_code, e.id as journal_entry_id
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
   where l.contract_id = p_contract_id and e.status = 'POSTED' and public.has_contract_access()
  order by document_date desc;
$$;

create or replace function public.get_contract_financial_summary(p_contract_id uuid)
returns table (
  received_amount    numeric(20,4),
  paid_amount        numeric(20,4),
  outstanding_amount numeric(20,4)
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select sum(r.amount) from public.receipts r where r.contract_id = p_contract_id and r.status = 'POSTED'), 0),
    coalesce((select sum(p.amount) from public.payments p where p.contract_id = p_contract_id and p.status = 'POSTED'), 0),
    c.total_amount - coalesce((select sum(r.amount) from public.receipts r where r.contract_id = p_contract_id and r.status = 'POSTED'), 0)
  from public.contracts c
  where c.id = p_contract_id and public.has_contract_access();
$$;

grant execute on function public.get_contract_financial_activity(uuid) to authenticated;
grant execute on function public.get_contract_financial_summary(uuid)  to authenticated;

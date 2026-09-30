-- =====================================================================
-- NIL Office — 0106_client_service_period_summary_received.sql
-- Financial Receipts & Payments — Phase 2, part 2 (Client Service
-- Ledger reconciliation).
--
-- Widens get_client_service_period_summary (0092) with a received_amount
-- column: the actual cash this client's SERVICE billing specifically has
-- pulled in for the period, via billing_batches.sales_document_id ->
-- cash_allocations (target_type='SALES_DOCUMENT', source_kind='RECEIPT')
-- -> receipts (status='POSTED'). Deliberately scoped through
-- billing_batches (not "any invoice for this company") so an unrelated
-- one-off company invoice never inflates this client's service-billing
-- received figure. Scoped by the receipt's own receipt_date, matching
-- how every other column here is scoped by its own substantive event
-- date (service_date/expense_date), not an administrative created_at.
--
-- Postgres requires DROP+CREATE (not CREATE OR REPLACE) to change a
-- function's RETURNS TABLE column list — the body below is the FULL
-- original 0092 body plus the new column, never a partial diff.
--
-- _get_client_service_received_by_currency is a narrow SECURITY DEFINER
-- bridge (mirrors get_contract_financial_summary's 0028 precedent),
-- gated on has_service_ledger_access() — NOT the whole outer function,
-- which stays non-definer so its five pre-existing columns keep their
-- exact original RLS-derived visibility (including the "own logged
-- entries even without a formal role" carve-out that other service-
-- ledger tables have per 0086). Only the new received_amount column
-- crosses into accounting-RLS territory (cash_allocations/receipts
-- require has_accounting_access()), and only for callers who already
-- have service-ledger access to this file (client_service_files' own
-- SELECT RLS already requires has_service_ledger_access() with no
-- "own record" exception, confirmed in 0086).
-- =====================================================================

create or replace function public._get_client_service_received_by_currency(
  p_client_service_file_id uuid,
  p_period_start           date,
  p_period_end             date
)
returns table (currency_code text, amount numeric(20,4))
language sql
stable
security definer
set search_path = public
as $$
  select sd.currency_code, coalesce(sum(ca.amount), 0) as amount
    from public.billing_batches bb
    join public.sales_documents sd on sd.id = bb.sales_document_id
    join public.cash_allocations ca
      on ca.target_type = 'SALES_DOCUMENT' and ca.target_id = sd.id and ca.source_kind = 'RECEIPT'
    join public.receipts r on r.id = ca.source_id and r.status = 'POSTED'
   where bb.client_service_file_id = p_client_service_file_id
     and bb.sales_document_id is not null
     and r.receipt_date between p_period_start and p_period_end
     and public.has_service_ledger_access()
   group by sd.currency_code;
$$;

grant execute on function public._get_client_service_received_by_currency(uuid, date, date) to authenticated;

drop function if exists public.get_client_service_period_summary(uuid, date, date);

create function public.get_client_service_period_summary(
  p_client_service_file_id uuid,
  p_period_start           date,
  p_period_end             date
)
returns table (
  currency_code             text,
  service_fee               numeric(20,4),
  billable_time_amount      numeric(20,4),
  reimbursable_expense_amount numeric(20,4),
  invoiced_amount           numeric(20,4),
  unbilled_amount           numeric(20,4),
  received_amount           numeric(20,4)
)
language sql
stable
as $$
  with entries as (
    select id, currency, service_fee, billing_status
    from public.service_entries
    where client_service_file_id = p_client_service_file_id
      and service_date between p_period_start and p_period_end
  ),
  fee_by_currency as (
    select currency as currency_code,
           coalesce(sum(service_fee), 0) as amount,
           coalesce(sum(service_fee) filter (where billing_status = 'INVOICED'), 0) as invoiced_amount,
           coalesce(sum(service_fee) filter (where billing_status not in ('INVOICED','WAIVED')), 0) as unbilled_amount
    from entries
    group by currency
  ),
  time_by_currency as (
    select entries.currency as currency_code,
           coalesce(sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) filter (where t.billable and t.hourly_rate_snapshot is not null), 0) as amount,
           coalesce(sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) filter (
             where t.billable and t.hourly_rate_snapshot is not null and entries.billing_status = 'INVOICED'
           ), 0) as invoiced_amount,
           coalesce(sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) filter (
             where t.billable and t.hourly_rate_snapshot is not null and entries.billing_status not in ('INVOICED','WAIVED')
           ), 0) as unbilled_amount
    from entries
    left join public.time_entries t on t.service_entry_id = entries.id
    group by entries.currency
  ),
  exp_rows as (
    select e.currency, e.reimbursable_amount, e.billing_status
    from public.expenses e
    join public.service_entries se on se.id = e.service_entry_id
    where se.client_service_file_id = p_client_service_file_id
      and e.expense_date between p_period_start and p_period_end
      and e.is_reimbursable
  ),
  exp_by_currency as (
    select currency as currency_code,
           coalesce(sum(reimbursable_amount), 0) as amount,
           coalesce(sum(reimbursable_amount) filter (where billing_status = 'INVOICED'), 0) as invoiced_amount,
           coalesce(sum(reimbursable_amount) filter (where billing_status not in ('INVOICED','WAIVED')), 0) as unbilled_amount
    from exp_rows
    group by currency
  ),
  received_by_currency as (
    select currency_code, amount
    from public._get_client_service_received_by_currency(p_client_service_file_id, p_period_start, p_period_end)
  ),
  currencies as (
    select currency_code from fee_by_currency
    union select currency_code from time_by_currency
    union select currency_code from exp_by_currency
    union select currency_code from received_by_currency
  )
  select
    c.currency_code,
    coalesce(f.amount, 0) as service_fee,
    coalesce(t.amount, 0) as billable_time_amount,
    coalesce(x.amount, 0) as reimbursable_expense_amount,
    coalesce(f.invoiced_amount, 0) + coalesce(t.invoiced_amount, 0) + coalesce(x.invoiced_amount, 0) as invoiced_amount,
    coalesce(f.unbilled_amount, 0) + coalesce(t.unbilled_amount, 0) + coalesce(x.unbilled_amount, 0) as unbilled_amount,
    coalesce(rb.amount, 0) as received_amount
  from currencies c
  left join fee_by_currency f on f.currency_code = c.currency_code
  left join time_by_currency t on t.currency_code = c.currency_code
  left join exp_by_currency x on x.currency_code = c.currency_code
  left join received_by_currency rb on rb.currency_code = c.currency_code;
$$;

grant execute on function public.get_client_service_period_summary(uuid, date, date) to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.get_client_service_period_summary(uuid, date, date);
-- drop function if exists public._get_client_service_received_by_currency(uuid, date, date);
-- Re-run 0092's original get_client_service_period_summary body
-- (without received_amount/the helper join) to fully revert.
-- =====================================================================

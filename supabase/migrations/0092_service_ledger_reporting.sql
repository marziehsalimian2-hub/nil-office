-- =====================================================================
-- NIL Office — 0092_service_ledger_reporting.sql
-- Client Service Ledger — Phase 3 (Executive Reporting).
--
-- Four new read-only rollups:
--   - get_client_service_period_summary — per-client, date-ranged, mirrors
--     get_client_service_claimable_summary's shape (0085) but adds
--     invoiced/unbilled split. STABLE, not security definer — only ever
--     reads rows the caller can already see via existing RLS, same
--     reasoning as every Phase 1/2 rollup.
--   - get_service_ledger_portfolio_counts / get_service_ledger_portfolio_money —
--     split by shape (single-valued counts vs currency-dimensioned
--     money) rather than one combined function, so a client with
--     unbilled money in two currencies doesn't force NULLs or a second
--     dimension onto the count columns. One row per ACTIVE client per
--     call — no N+1, the caller does one query each, not one per client.
--   - get_client_service_profitability — SECURITY DEFINER, gated on
--     can_view_internal_cost() (mirrors get_contract_financial_summary's
--     0028 precedent of a security-definer rollup bridging past the
--     caller's own narrower RLS): a manager reading company-wide
--     profitability needs to see time_entry_internal_costs rows logged
--     by OTHER people, which Phase 1's own RLS (admin-tier OR
--     performed_by = self) would otherwise block. Returns
--     data_complete=false per currency whenever ANY billable time_entries
--     row in the period lacks a time_entry_internal_costs snapshot —
--     the UI must show "insufficient data", never treat a missing rate
--     as zero cost (that would overstate profitability).
--
-- Expenses are attributed to a period by their OWN expense_date, not
-- their parent service_entries.service_date — an expense incurred in a
-- later month than the service it supports still belongs to the month
-- it was actually paid.
-- =====================================================================

create index if not exists idx_expenses_expense_date on public.expenses (expense_date);

-- ---------------------------------------------------------------------
-- get_client_service_period_summary
-- ---------------------------------------------------------------------
create or replace function public.get_client_service_period_summary(
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
  unbilled_amount           numeric(20,4)
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
  currencies as (
    select currency_code from fee_by_currency
    union select currency_code from time_by_currency
    union select currency_code from exp_by_currency
  )
  select
    c.currency_code,
    coalesce(f.amount, 0) as service_fee,
    coalesce(t.amount, 0) as billable_time_amount,
    coalesce(x.amount, 0) as reimbursable_expense_amount,
    coalesce(f.invoiced_amount, 0) + coalesce(t.invoiced_amount, 0) + coalesce(x.invoiced_amount, 0) as invoiced_amount,
    coalesce(f.unbilled_amount, 0) + coalesce(t.unbilled_amount, 0) + coalesce(x.unbilled_amount, 0) as unbilled_amount
  from currencies c
  left join fee_by_currency f on f.currency_code = c.currency_code
  left join time_by_currency t on t.currency_code = c.currency_code
  left join exp_by_currency x on x.currency_code = c.currency_code;
$$;

-- ---------------------------------------------------------------------
-- get_service_ledger_portfolio_counts — one row per ACTIVE client, no
-- currency dimension.
-- ---------------------------------------------------------------------
create or replace function public.get_service_ledger_portfolio_counts(
  p_period_start date,
  p_period_end   date
)
returns table (
  client_service_file_id uuid,
  company_id             uuid,
  company_name           text,
  services_count         bigint,
  hours_total            numeric,
  requires_billing       boolean
)
language sql
stable
as $$
  select
    f.id as client_service_file_id,
    f.company_id,
    c.legal_name as company_name,
    count(distinct se.id) as services_count,
    coalesce(sum(t.duration_minutes) filter (where t.billable), 0) / 60.0 as hours_total,
    (
      exists (select 1 from public.service_entries se2 where se2.client_service_file_id = f.id and se2.billing_status = 'READY_TO_BILL')
      or exists (
        select 1 from public.expenses e2
        join public.service_entries se3 on se3.id = e2.service_entry_id
        where se3.client_service_file_id = f.id and e2.billing_status = 'READY_TO_BILL'
      )
    ) as requires_billing
  from public.client_service_files f
  join public.companies c on c.id = f.company_id
  left join public.service_entries se on se.client_service_file_id = f.id and se.service_date between p_period_start and p_period_end
  left join public.time_entries t on t.service_entry_id = se.id
  where f.status = 'ACTIVE'
  group by f.id, f.company_id, c.legal_name;
$$;

-- ---------------------------------------------------------------------
-- get_service_ledger_portfolio_money — one row per (client, currency).
-- ---------------------------------------------------------------------
create or replace function public.get_service_ledger_portfolio_money(
  p_period_start date,
  p_period_end   date
)
returns table (
  client_service_file_id         uuid,
  currency_code                  text,
  unbilled_amount                numeric(20,4),
  reimbursable_outstanding_amount numeric(20,4)
)
language sql
stable
as $$
  with entry_unbilled as (
    select client_service_file_id, currency as currency_code,
           coalesce(sum(service_fee) filter (where billing_status not in ('INVOICED','WAIVED')), 0) as fee_unbilled
    from public.service_entries
    where service_date between p_period_start and p_period_end
    group by client_service_file_id, currency
  ),
  time_unbilled as (
    select se.client_service_file_id, se.currency as currency_code,
           coalesce(sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) filter (
             where t.billable and t.hourly_rate_snapshot is not null and se.billing_status not in ('INVOICED','WAIVED')
           ), 0) as time_unbilled
    from public.service_entries se
    join public.time_entries t on t.service_entry_id = se.id
    where se.service_date between p_period_start and p_period_end
    group by se.client_service_file_id, se.currency
  ),
  exp_outstanding as (
    select se.client_service_file_id, e.currency as currency_code,
           coalesce(sum(e.reimbursable_amount) filter (where e.billing_status not in ('INVOICED','WAIVED')), 0) as reimbursable_outstanding
    from public.expenses e
    join public.service_entries se on se.id = e.service_entry_id
    where e.is_reimbursable and e.expense_date between p_period_start and p_period_end
    group by se.client_service_file_id, e.currency
  ),
  keys as (
    select client_service_file_id, currency_code from entry_unbilled
    union select client_service_file_id, currency_code from time_unbilled
    union select client_service_file_id, currency_code from exp_outstanding
  )
  select
    k.client_service_file_id,
    k.currency_code,
    coalesce(eu.fee_unbilled, 0) + coalesce(tu.time_unbilled, 0) as unbilled_amount,
    coalesce(eo.reimbursable_outstanding, 0) as reimbursable_outstanding_amount
  from keys k
  left join entry_unbilled eu on eu.client_service_file_id = k.client_service_file_id and eu.currency_code = k.currency_code
  left join time_unbilled tu on tu.client_service_file_id = k.client_service_file_id and tu.currency_code = k.currency_code
  left join exp_outstanding eo on eo.client_service_file_id = k.client_service_file_id and eo.currency_code = k.currency_code;
$$;

-- ---------------------------------------------------------------------
-- get_client_service_profitability — confidential, SECURITY DEFINER.
-- ---------------------------------------------------------------------
create or replace function public.get_client_service_profitability(
  p_client_service_file_id uuid,
  p_period_start           date,
  p_period_end             date
)
returns table (
  currency_code             text,
  revenue                   numeric(20,4),
  internal_time_cost        numeric(20,4),
  non_reimbursed_direct_cost numeric(20,4),
  contribution_margin       numeric(20,4),
  data_complete             boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_internal_cost() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  with entries as (
    select id, currency, service_fee
    from public.service_entries
    where client_service_file_id = p_client_service_file_id
      and service_date between p_period_start and p_period_end
  ),
  revenue_by_currency as (
    select currency as currency_code, coalesce(sum(service_fee), 0) as amount
    from entries
    group by currency
  ),
  time_rows as (
    select entries.currency as currency_code, t.duration_minutes, t.hourly_rate_snapshot, t.billable, tc.internal_cost_amount
    from entries
    join public.time_entries t on t.service_entry_id = entries.id
    left join public.time_entry_internal_costs tc on tc.time_entry_id = t.id
  ),
  time_by_currency as (
    select currency_code,
           coalesce(sum(internal_cost_amount) filter (where billable), 0) as cost_amount,
           bool_or(billable and internal_cost_amount is null) as missing_cost
    from time_rows
    group by currency_code
  ),
  exp_rows as (
    select e.currency as currency_code, e.amount, e.is_reimbursable
    from public.expenses e
    join public.service_entries se on se.id = e.service_entry_id
    where se.client_service_file_id = p_client_service_file_id
      and e.expense_date between p_period_start and p_period_end
  ),
  exp_by_currency as (
    select currency_code, coalesce(sum(amount) filter (where not is_reimbursable), 0) as non_reimbursed_amount
    from exp_rows
    group by currency_code
  ),
  currencies as (
    select currency_code from revenue_by_currency
    union select currency_code from time_by_currency
    union select currency_code from exp_by_currency
  )
  select
    c.currency_code,
    coalesce(r.amount, 0) as revenue,
    coalesce(t.cost_amount, 0) as internal_time_cost,
    coalesce(x.non_reimbursed_amount, 0) as non_reimbursed_direct_cost,
    coalesce(r.amount, 0) - coalesce(t.cost_amount, 0) - coalesce(x.non_reimbursed_amount, 0) as contribution_margin,
    coalesce(t.missing_cost, false) = false as data_complete
  from currencies c
  left join revenue_by_currency r on r.currency_code = c.currency_code
  left join time_by_currency t on t.currency_code = c.currency_code
  left join exp_by_currency x on x.currency_code = c.currency_code;
end;
$$;

grant execute on function public.get_client_service_period_summary(uuid, date, date) to authenticated;
grant execute on function public.get_service_ledger_portfolio_counts(date, date) to authenticated;
grant execute on function public.get_service_ledger_portfolio_money(date, date) to authenticated;
grant execute on function public.get_client_service_profitability(uuid, date, date) to authenticated;

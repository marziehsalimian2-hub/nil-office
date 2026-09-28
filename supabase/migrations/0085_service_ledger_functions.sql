-- =====================================================================
-- NIL Office — 0085_service_ledger_functions.sql
-- Client Service Ledger — Phase 1 — cost-rate bridge, claimable-amount
-- rollups, immutability guard, touch/audit wiring, grants.
-- (Role/permission helpers already live in 0082_service_ledger_role.sql,
-- mirroring 0073_cheque_role.sql's combined role+helpers convention.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- get_internal_cost_rate_for_snapshot — SECURITY DEFINER bridge so ANY
-- active user creating a time entry can snapshot the right rate, even
-- though internal_cost_rates itself is ADMIN-only readable (0086). The
-- raw number this returns must never be re-exposed verbatim to the
-- caller by the TS action that calls it — only written into
-- time_entry_internal_costs, never returned in an action's response.
-- ---------------------------------------------------------------------
create or replace function public.get_internal_cost_rate_for_snapshot(p_profile_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select hourly_cost_rate from public.internal_cost_rates where profile_id = p_profile_id;
$$;

-- ---------------------------------------------------------------------
-- Claimable Amount rollups — mirror get_contract_financial_summary /
-- get_project_progress_summary exactly: parameterized, STABLE, NOT
-- security definer (only aggregates rows the caller can already see
-- through service_entries/time_entries/expenses' own RLS). Grouped by
-- currency_code — never silently summed across currencies (spec's
-- non-negotiable "no currency mixing" rule).
-- ---------------------------------------------------------------------
create or replace function public.get_service_entry_claimable_amount(p_service_entry_id uuid)
returns table (
  currency_code             text,
  service_fee               numeric(20,4),
  billable_time_amount      numeric(20,4),
  reimbursable_expense_amount numeric(20,4),
  claimable_total           numeric(20,4)
)
language sql
stable
as $$
  with se as (
    select id, currency, service_fee from public.service_entries where id = p_service_entry_id
  ),
  time_amt as (
    select
      coalesce(se.currency, 'IRR') as currency_code,
      coalesce(sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) filter (where t.billable and t.hourly_rate_snapshot is not null), 0) as amount
    from se
    left join public.time_entries t on t.service_entry_id = se.id
    group by se.currency
  ),
  exp_amt as (
    select
      coalesce(se.currency, 'IRR') as currency_code,
      coalesce(sum(e.reimbursable_amount) filter (where e.is_reimbursable), 0) as amount
    from se
    left join public.expenses e on e.service_entry_id = se.id
    group by se.currency
  )
  select
    se.currency as currency_code,
    se.service_fee,
    coalesce(time_amt.amount, 0) as billable_time_amount,
    coalesce(exp_amt.amount, 0) as reimbursable_expense_amount,
    se.service_fee + coalesce(time_amt.amount, 0) + coalesce(exp_amt.amount, 0) as claimable_total
  from se
  left join time_amt on time_amt.currency_code = se.currency
  left join exp_amt on exp_amt.currency_code = se.currency;
$$;

create or replace function public.get_client_service_claimable_summary(p_client_service_file_id uuid)
returns table (
  currency_code             text,
  service_fee               numeric(20,4),
  billable_time_amount      numeric(20,4),
  reimbursable_expense_amount numeric(20,4),
  claimable_total           numeric(20,4)
)
language sql
stable
as $$
  with entries as (
    select id, currency, service_fee
    from public.service_entries
    where client_service_file_id = p_client_service_file_id
  ),
  fee_by_currency as (
    select currency as currency_code, coalesce(sum(service_fee), 0) as amount from entries group by currency
  ),
  time_by_currency as (
    select entries.currency as currency_code,
           coalesce(sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) filter (where t.billable and t.hourly_rate_snapshot is not null), 0) as amount
    from entries
    left join public.time_entries t on t.service_entry_id = entries.id
    group by entries.currency
  ),
  exp_by_currency as (
    select entries.currency as currency_code,
           coalesce(sum(e.reimbursable_amount) filter (where e.is_reimbursable), 0) as amount
    from entries
    left join public.expenses e on e.service_entry_id = entries.id
    group by entries.currency
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
    coalesce(e.amount, 0) as reimbursable_expense_amount,
    coalesce(f.amount, 0) + coalesce(t.amount, 0) + coalesce(e.amount, 0) as claimable_total
  from currencies c
  left join fee_by_currency f on f.currency_code = c.currency_code
  left join time_by_currency t on t.currency_code = c.currency_code
  left join exp_by_currency e on e.currency_code = c.currency_code;
$$;

-- ---------------------------------------------------------------------
-- Immutability guard: once a confidential cost snapshot is written, it
-- can never be changed (only deleted via cascade if the time entry
-- itself is deleted). Mirrors tg_project_guard's numbering-immutable
-- idiom (0052_project_task_functions.sql).
-- ---------------------------------------------------------------------
create or replace function public.tg_time_entry_cost_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.internal_cost_rate_snapshot is distinct from old.internal_cost_rate_snapshot
     or new.internal_cost_amount is distinct from old.internal_cost_amount then
    raise exception 'SNAPSHOT_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_time_entry_cost_immutable on public.time_entry_internal_costs;
create trigger trg_time_entry_cost_immutable
  before update on public.time_entry_internal_costs
  for each row execute function public.tg_time_entry_cost_immutable();

-- ---------------------------------------------------------------------
-- updated_at touch + generic audit trigger for the new tables (mirrors
-- 0052's loop). time_entry_internal_costs has no updated_at (write-once
-- by design) so it's excluded from the touch loop but included in audit.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'client_service_files','service_arrangements','service_categories',
    'service_entries','time_entries','expenses','internal_cost_rates'
  ]
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'client_service_files','service_arrangements','service_categories',
    'service_entries','time_entries','time_entry_internal_costs',
    'expenses','internal_cost_rates'
  ]
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Grants — mandatory base grant (0013_table_grants.sql gotcha): Postgres
-- checks object privilege before RLS, so skipping this makes every
-- query 42501 regardless of correct RLS.
-- ---------------------------------------------------------------------
grant execute on function public.get_internal_cost_rate_for_snapshot(uuid) to authenticated;
grant execute on function public.get_service_entry_claimable_amount(uuid) to authenticated;
grant execute on function public.get_client_service_claimable_summary(uuid) to authenticated;

grant select, insert, update, delete on
  public.client_service_files,
  public.service_arrangements,
  public.service_categories,
  public.service_entries,
  public.time_entries,
  public.time_entry_internal_costs,
  public.internal_cost_rates,
  public.expenses
  to authenticated;

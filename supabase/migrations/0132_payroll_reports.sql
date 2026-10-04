-- =====================================================================
-- NIL Office — 0132_payroll_reports.sql
-- HR & Payroll — Phase 7 — dashboards + reports (READ-ONLY).
--  * Every function is STABLE SECURITY DEFINER with the gate FIRST: payroll RPCs = has_payroll_access() (HR-only users get
--    NOT_AUTHORIZED — salary never reaches HR); hr_payroll_gaps = has_hr_access() OR has_payroll_access() and returns COUNTS ONLY.
--  * Amounts leave the DB as numeric::text (exact). Everything is grouped BY CURRENCY — currencies are never summed.
--  * Basis: the APPROVED calculation for APPROVED batches, otherwise the current calculation (every row carries `basis`).
--    Cancelled batches are excluded. "Paid" = a linked payment that is POSTED AND whose journal entry is still POSTED (Phase 5/6 rule).
--  * Reconciliation is computed here so payroll-only users never read journal_* / payments themselves.
--  * No tables, no policy changes except p_logs_read, restated from its CURRENT body (0131, verified by grep) + 2 entity types.
--  * No write_log payload contains an amount. service_role: NOT granted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- internal: one row per payroll result of every non-cancelled batch that has a calculation
-- ---------------------------------------------------------------------
create or replace function public._payroll_report_base()
returns table (
  batch_id uuid, batch_number text, batch_status text, basis text, currency text,
  period_id uuid, jalali_year integer, jalali_month integer, journal_id uuid,
  result_id uuid, personnel_id uuid, personnel_number text, personnel_name text,
  gross numeric, total_deductions numeric, employer_cost numeric, net numeric, is_complete boolean
)
language sql stable security definer set search_path = public as $$
  select b.id, b.batch_number, b.status, case when b.status = 'APPROVED' then 'APPROVED' else 'CALCULATED' end, b.currency,
         per.id, per.jalali_year, per.jalali_month, b.accounting_journal_entry_id,
         r.id, r.personnel_id, r.personnel_number, r.personnel_name,
         r.gross, r.total_deductions, r.employer_cost, r.net, r.is_complete
    from public.payroll_batches b
    join public.payroll_periods per on per.id = b.period_id
    join public.payroll_results r
      on r.calculation_id = case when b.status = 'APPROVED' then b.approved_calculation_id else b.current_calculation_id end
   where b.status <> 'CANCELLED';
$$;

-- ---------------------------------------------------------------------
-- Payroll dashboard (one period; default = latest). Per-currency money cards + pipeline counts + gap counts.
-- ---------------------------------------------------------------------
create or replace function public.payroll_dashboard(p_period_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_per public.payroll_periods; v_periods jsonb; v_pipeline jsonb; v_cur jsonb; v_mwd integer := 0; v_mc integer := 0;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_period_id is null then
    select * into v_per from public.payroll_periods order by jalali_year desc, jalali_month desc limit 1;
  else
    select * into v_per from public.payroll_periods where id = p_period_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'jalali_year', x.jalali_year, 'jalali_month', x.jalali_month)
                            order by x.jalali_year desc, x.jalali_month desc), '[]'::jsonb)
    into v_periods
    from (select id, jalali_year, jalali_month from public.payroll_periods order by jalali_year desc, jalali_month desc limit 36) x;

  select jsonb_build_object(
           'draft', count(*) filter (where b.status = 'DRAFT'),
           'calculated', count(*) filter (where b.status = 'CALCULATED'),
           'pending_review', count(*) filter (where b.status = 'UNDER_REVIEW' and b.reviewed_at is null),
           'pending_approval', count(*) filter (where b.status = 'UNDER_REVIEW' and b.reviewed_at is not null),
           'approved', count(*) filter (where b.status = 'APPROVED'),
           'pending_payment', count(*) filter (where b.status = 'APPROVED' and exists (
               select 1 from public.payroll_results r cross join lateral public._payroll_result_payment(r.id) cp
                where r.calculation_id = b.approved_calculation_id and cp.state <> 'PAID')))
    into v_pipeline
    from public.payroll_batches b where b.status <> 'CANCELLED';

  if v_per.id is null then
    return jsonb_build_object('period', null, 'periods', v_periods, 'pipeline', v_pipeline,
                              'currencies', '[]'::jsonb, 'gaps', jsonb_build_object('missing_work_data', 0, 'missing_compensation', 0));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', c.currency, 'personnel_count', c.n, 'incomplete', c.incomplete,
           'gross', c.gross::text, 'deductions', c.deductions::text, 'net', c.net::text, 'employer_cost', c.employer_cost::text,
           'approved_net', c.approved_net::text, 'paid', c.paid::text, 'outstanding', (c.approved_net - c.paid)::text)
           order by c.currency), '[]'::jsonb)
    into v_cur
    from (
      select b.currency, count(*) as n, count(*) filter (where not b.is_complete) as incomplete,
             sum(b.gross) as gross, sum(b.total_deductions) as deductions, sum(b.net) as net, sum(b.employer_cost) as employer_cost,
             coalesce(sum(b.net) filter (where b.batch_status = 'APPROVED'), 0) as approved_net,
             coalesce(sum(cp.paid) filter (where b.batch_status = 'APPROVED'), 0) as paid
        from public._payroll_report_base() b
        left join lateral public._payroll_result_payment(b.result_id) cp on b.batch_status = 'APPROVED'
       where b.period_id = v_per.id
       group by b.currency) c;

  select count(*) into v_mwd from public._payroll_eligibility(v_per.id, null) e
   where e.included and not exists (select 1 from public.payroll_work_data wd where wd.period_id = v_per.id and wd.personnel_id = e.personnel_id);
  select count(*) into v_mc from public._payroll_eligibility(v_per.id, null) e where e.included and e.profile_id is null;

  return jsonb_build_object(
    'period', jsonb_build_object('id', v_per.id, 'jalali_year', v_per.jalali_year, 'jalali_month', v_per.jalali_month,
                                 'period_start', v_per.period_start, 'period_end', v_per.period_end),
    'periods', v_periods, 'pipeline', v_pipeline, 'currencies', v_cur,
    'gaps', jsonb_build_object('missing_work_data', v_mwd, 'missing_compensation', v_mc));
end; $$;

-- ---------------------------------------------------------------------
-- HR-visible COUNTS ONLY (no amounts): active personnel without a compensation profile today, and (latest period) eligible
-- personnel without work data.
-- ---------------------------------------------------------------------
create or replace function public.hr_payroll_gaps()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_per public.payroll_periods; v_mc integer; v_mwd integer := 0;
begin
  if not (public.has_hr_access() or public.has_payroll_access()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select count(*) into v_mc from public.personnel p
   where p.employment_status in ('ACTIVE','ON_LEAVE','SUSPENDED') and (public._payroll_profile_on(p.id, current_date)).id is null;
  select * into v_per from public.payroll_periods order by jalali_year desc, jalali_month desc limit 1;
  if v_per.id is not null then
    select count(*) into v_mwd from public._payroll_eligibility(v_per.id, null) e
     where e.included and not exists (select 1 from public.payroll_work_data wd where wd.period_id = v_per.id and wd.personnel_id = e.personnel_id);
  end if;
  return jsonb_build_object('missing_compensation', v_mc, 'missing_work_data', v_mwd,
                            'period', case when v_per.id is null then null
                                           else jsonb_build_object('jalali_year', v_per.jalali_year, 'jalali_month', v_per.jalali_month) end);
end; $$;

-- ---------------------------------------------------------------------
-- Payroll register: every result of one period (optionally one currency) + per-currency totals.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_register(p_period_id uuid, p_currency text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_totals jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_period_id is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batch_number', b.batch_number, 'batch_status', b.batch_status, 'basis', b.basis, 'currency', b.currency,
           'personnel_number', b.personnel_number, 'personnel_name', b.personnel_name,
           'gross', b.gross::text, 'deductions', b.total_deductions::text, 'employer_cost', b.employer_cost::text, 'net', b.net::text,
           'is_complete', b.is_complete, 'payment_state', cp.state,
           'paid', cp.paid::text, 'outstanding', case when cp.state is null then null else (b.net - cp.paid)::text end)
           order by b.batch_number, b.personnel_number), '[]'::jsonb)
    into v_rows
    from public._payroll_report_base() b
    left join lateral public._payroll_result_payment(b.result_id) cp on b.batch_status = 'APPROVED'
   where b.period_id = p_period_id and (p_currency is null or b.currency = p_currency);

  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', t.currency, 'personnel_count', t.n, 'gross', t.gross::text, 'deductions', t.deductions::text,
           'employer_cost', t.employer_cost::text, 'net', t.net::text) order by t.currency), '[]'::jsonb)
    into v_totals
    from (select b.currency, count(*) as n, sum(b.gross) as gross, sum(b.total_deductions) as deductions,
                 sum(b.employer_cost) as employer_cost, sum(b.net) as net
            from public._payroll_report_base() b
           where b.period_id = p_period_id and (p_currency is null or b.currency = p_currency)
           group by b.currency) t;

  return jsonb_build_object('rows', v_rows, 'totals', v_totals);
end; $$;

-- ---------------------------------------------------------------------
-- By period (also serves Gross/Net and Employer Cost): one row per (period, currency). Jalali range filter; newest first; max 500.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_by_period(
  p_from_year integer default null, p_from_month integer default null,
  p_to_year integer default null, p_to_month integer default null, p_currency text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lo integer; v_hi integer; v_rows jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_lo := case when p_from_year is null then -1 else p_from_year * 12 + coalesce(p_from_month, 1) end;
  v_hi := case when p_to_year is null then 1000000 else p_to_year * 12 + coalesce(p_to_month, 12) end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'jalali_year', g.jalali_year, 'jalali_month', g.jalali_month, 'currency', g.currency,
           'batches', g.batches, 'personnel_count', g.n, 'incomplete', g.incomplete,
           'gross', g.gross::text, 'deductions', g.deductions::text, 'net', g.net::text, 'employer_cost', g.employer_cost::text,
           'all_approved', g.all_approved, 'paid', g.paid::text, 'outstanding', case when g.all_approved then (g.net - g.paid)::text else null end)
           order by g.jalali_year desc, g.jalali_month desc, g.currency), '[]'::jsonb)
    into v_rows
    from (
      select * from (
        select b.jalali_year, b.jalali_month, b.currency, count(distinct b.batch_id) as batches, count(*) as n,
               count(*) filter (where not b.is_complete) as incomplete,
               sum(b.gross) as gross, sum(b.total_deductions) as deductions, sum(b.net) as net, sum(b.employer_cost) as employer_cost,
               bool_and(b.batch_status = 'APPROVED') as all_approved,
               coalesce(sum(cp.paid) filter (where b.batch_status = 'APPROVED'), 0) as paid
          from public._payroll_report_base() b
          left join lateral public._payroll_result_payment(b.result_id) cp on b.batch_status = 'APPROVED'
         where (b.jalali_year * 12 + b.jalali_month) between v_lo and v_hi and (p_currency is null or b.currency = p_currency)
         group by b.jalali_year, b.jalali_month, b.currency
         order by b.jalali_year desc, b.jalali_month desc, b.currency
         limit 500) q
    ) g;
  return jsonb_build_object('rows', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- People who have payroll history (for the by-personnel / compensation pickers). Payroll-only users cannot read personnel.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_personnel_options()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'number', p.personnel_number, 'name', p.first_name || ' ' || p.last_name)
                     order by p.personnel_number)
      from public.personnel p
     where exists (select 1 from public.payroll_results r where r.personnel_id = p.id)
        or exists (select 1 from public.compensation_profiles c where c.personnel_id = p.id)), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------
-- By personnel: one person's history, one row per period/batch.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_by_personnel(
  p_personnel_id uuid, p_from_year integer default null, p_from_month integer default null,
  p_to_year integer default null, p_to_month integer default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lo integer; v_hi integer; v_rows jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_personnel_id is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  v_lo := case when p_from_year is null then -1 else p_from_year * 12 + coalesce(p_from_month, 1) end;
  v_hi := case when p_to_year is null then 1000000 else p_to_year * 12 + coalesce(p_to_month, 12) end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'jalali_year', b.jalali_year, 'jalali_month', b.jalali_month, 'batch_number', b.batch_number, 'batch_status', b.batch_status,
           'basis', b.basis, 'currency', b.currency, 'gross', b.gross::text, 'deductions', b.total_deductions::text,
           'employer_cost', b.employer_cost::text, 'net', b.net::text, 'is_complete', b.is_complete,
           'payment_state', cp.state, 'paid', cp.paid::text,
           'payslip_revisions', (select count(*) from public.payroll_payslips s where s.result_id = b.result_id))
           order by b.jalali_year desc, b.jalali_month desc, b.batch_number), '[]'::jsonb)
    into v_rows
    from public._payroll_report_base() b
    left join lateral public._payroll_result_payment(b.result_id) cp on b.batch_status = 'APPROVED'
   where b.personnel_id = p_personnel_id and (b.jalali_year * 12 + b.jalali_month) between v_lo and v_hi;
  return jsonb_build_object('rows', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- Component report: totals per component (earning / deduction / employer cost / informational) per currency for one period.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_components(p_period_id uuid, p_currency text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_period_id is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'component_type', g.component_type, 'component_code', g.component_code, 'component_name', g.name_fa, 'currency', g.currency,
           'personnel_count', g.persons, 'total', g.total::text)
           order by g.component_type, g.component_code, g.currency), '[]'::jsonb)
    into v_rows
    from (
      select l.component_type::text as component_type, l.component_code, max(l.component_name_fa) as name_fa, b.currency,
             count(distinct b.personnel_id) as persons, sum(l.amount) as total
        from public._payroll_report_base() b
        join public.payroll_result_lines l on l.result_id = b.result_id and l.status = 'COMPUTED'
       where b.period_id = p_period_id and (p_currency is null or b.currency = p_currency)
       group by l.component_type, l.component_code, b.currency) g;
  return jsonb_build_object('rows', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- Payment status / outstanding (APPROVED batches only): per person.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_payments(
  p_period_id uuid default null, p_currency text default null, p_only_outstanding boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_totals jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'jalali_year', y.jalali_year, 'jalali_month', y.jalali_month, 'batch_number', y.batch_number, 'currency', y.currency,
           'personnel_number', y.personnel_number, 'personnel_name', y.personnel_name,
           'net', y.net::text, 'paid', y.paid::text, 'drafted', y.drafted::text, 'outstanding', (y.net - y.paid)::text,
           'payment_state', case when y.net > 0 and y.paid >= y.net then 'PAID' when y.paid > 0 then 'PARTIALLY_PAID' else 'NOT_PAID' end,
           'last_payment_date', y.last_date, 'overpaid', y.paid > y.net, 'amount_changed', y.changed)
           order by y.jalali_year desc, y.jalali_month desc, y.batch_number, y.personnel_number), '[]'::jsonb)
    into v_rows
    from (
      select b.jalali_year, b.jalali_month, b.batch_number, b.currency, b.personnel_number, b.personnel_name, b.net,
             pay.paid, pay.drafted, pay.changed, pay.last_date
        from public._payroll_report_base() b
        cross join lateral (
          select coalesce(sum(p.amount) filter (where p.status = 'POSTED' and j.status = 'POSTED'), 0) as paid,
                 coalesce(sum(p.amount) filter (where p.status = 'DRAFT'), 0) as drafted,
                 coalesce(bool_or(p.amount <> pp.amount_snapshot), false) as changed,
                 max(p.payment_date) filter (where p.status = 'POSTED' and j.status = 'POSTED') as last_date
            from public.payroll_payments pp
            join public.payments p on p.id = pp.payment_id
            left join public.journal_entries j on j.id = p.journal_entry_id
           where pp.result_id = b.result_id) pay
       where b.batch_status = 'APPROVED'
         and (p_period_id is null or b.period_id = p_period_id)
         and (p_currency is null or b.currency = p_currency)
         and (not coalesce(p_only_outstanding, false) or (b.net - pay.paid) > 0)
       limit 5000) y;

  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', t.currency, 'net', t.net::text, 'paid', t.paid::text, 'outstanding', (t.net - t.paid)::text) order by t.currency), '[]'::jsonb)
    into v_totals
    from (
      select b.currency, sum(b.net) as net, sum(pay.paid) as paid
        from public._payroll_report_base() b
        cross join lateral (
          select coalesce(sum(p.amount) filter (where p.status = 'POSTED' and j.status = 'POSTED'), 0) as paid
            from public.payroll_payments pp join public.payments p on p.id = pp.payment_id
            left join public.journal_entries j on j.id = p.journal_entry_id
           where pp.result_id = b.result_id) pay
       where b.batch_status = 'APPROVED' and (p_period_id is null or b.period_id = p_period_id) and (p_currency is null or b.currency = p_currency)
         and (not coalesce(p_only_outstanding, false) or (b.net - pay.paid) > 0)
       group by b.currency) t;
  return jsonb_build_object('rows', v_rows, 'totals', v_totals);
end; $$;

-- ---------------------------------------------------------------------
-- Payroll <-> accounting <-> payments reconciliation, per APPROVED batch.
-- journal_net_credit = credit on the configured net-payable account of the linked journal entry (NULL when nothing is linked).
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_reconciliation(p_period_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_net_acct uuid; v_rows jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select net_payable_account_id into v_net_acct from public.payroll_accounting_settings limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'jalali_year', x.jalali_year, 'jalali_month', x.jalali_month, 'batch_number', x.batch_number, 'currency', x.currency,
           'personnel_count', x.n, 'total_net', x.net::text, 'total_deductions', x.deductions::text, 'employer_cost', x.employer::text,
           'journal_status', x.j_status, 'journal_net_credit', x.net_credit::text,
           'net_difference', case when x.net_credit is null then null else (x.net - x.net_credit)::text end,
           'paid', x.paid::text, 'drafted', x.drafted::text, 'outstanding', (x.net - x.paid)::text,
           'flags', to_jsonb(array_remove(array[
             case when x.j_status is null or x.j_status = 'REVERSED' then 'JOURNAL_MISSING' end,
             case when x.j_status = 'DRAFT' then 'JOURNAL_NOT_POSTED' end,
             case when x.j_status in ('DRAFT','POSTED') and x.net_credit is distinct from x.net then 'NET_PAYABLE_MISMATCH' end,
             case when x.paid > x.net then 'OVERPAID' end,
             case when x.changed then 'PAYMENT_AMOUNT_CHANGED' end,
             case when x.net > 0 and x.paid = 0 then 'UNPAID' end], null)))
           order by x.jalali_year desc, x.jalali_month desc, x.batch_number), '[]'::jsonb)
    into v_rows
    from (
      select per.jalali_year, per.jalali_month, b.batch_number, b.currency, b.id as batch_id,
             (select count(*) from public.payroll_results r where r.calculation_id = b.approved_calculation_id) as n,
             (select coalesce(sum(r.net), 0) from public.payroll_results r where r.calculation_id = b.approved_calculation_id) as net,
             (select coalesce(sum(r.total_deductions), 0) from public.payroll_results r where r.calculation_id = b.approved_calculation_id) as deductions,
             (select coalesce(sum(r.employer_cost), 0) from public.payroll_results r where r.calculation_id = b.approved_calculation_id) as employer,
             je.status::text as j_status,
             case when je.id is null or v_net_acct is null then null
                  else (select coalesce(sum(l.credit), 0) from public.journal_entry_lines l where l.journal_entry_id = je.id and l.account_id = v_net_acct) end as net_credit,
             coalesce(pay.paid, 0) as paid, coalesce(pay.drafted, 0) as drafted, coalesce(pay.changed, false) as changed
        from public.payroll_batches b
        join public.payroll_periods per on per.id = b.period_id
        left join public.journal_entries je on je.id = b.accounting_journal_entry_id
        left join lateral (
          select coalesce(sum(p.amount) filter (where p.status = 'POSTED' and j.status = 'POSTED'), 0) as paid,
                 coalesce(sum(p.amount) filter (where p.status = 'DRAFT'), 0) as drafted,
                 coalesce(bool_or(p.amount <> pp.amount_snapshot), false) as changed
            from public.payroll_payments pp join public.payments p on p.id = pp.payment_id
            left join public.journal_entries j on j.id = p.journal_entry_id
           where pp.batch_id = b.id) pay on true
       where b.status = 'APPROVED' and (p_period_id is null or b.period_id = p_period_id)) x;
  return jsonb_build_object('rows', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- Payslip history / coverage (APPROVED batches): who has a payslip, latest revision, is it up to date with the real payment state.
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_payslips(p_period_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'jalali_year', b.jalali_year, 'jalali_month', b.jalali_month, 'batch_number', b.batch_number, 'currency', b.currency,
           'personnel_number', b.personnel_number, 'personnel_name', b.personnel_name,
           'current_state', cp.state,
           'revisions', (select count(*) from public.payroll_payslips s where s.result_id = b.result_id),
           'latest_revision', ls.revision, 'latest_state', ls.payment_state_at_issue, 'latest_issued_at', ls.issued_at,
           'issued', ls.revision is not null, 'up_to_date', ls.revision is not null and ls.payment_state_at_issue = cp.state)
           order by b.jalali_year desc, b.jalali_month desc, b.batch_number, b.personnel_number), '[]'::jsonb)
    into v_rows
    from public._payroll_report_base() b
    cross join lateral public._payroll_result_payment(b.result_id) cp
    left join lateral (select s.revision, s.payment_state_at_issue, s.issued_at from public.payroll_payslips s
                        where s.result_id = b.result_id order by s.revision desc limit 1) ls on true
   where b.batch_status = 'APPROVED' and (p_period_id is null or b.period_id = p_period_id);
  return jsonb_build_object('rows', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- Compensation history (payroll tier): one row per compensation version; one person or everyone (max 2000).
-- ---------------------------------------------------------------------
create or replace function public.payroll_report_compensation_history(p_personnel_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'personnel_number', q.personnel_number, 'personnel_name', q.name, 'version_number', q.version_number,
           'effective_from', q.effective_from, 'effective_to', q.effective_to, 'base_salary', q.base_salary::text,
           'currency', q.currency, 'payment_frequency', q.payment_frequency, 'hourly_rate', q.hourly_rate::text, 'line_count', q.line_count)
           order by q.personnel_number, q.version_number desc), '[]'::jsonb)
    into v_rows
    from (
      select p.personnel_number, p.first_name || ' ' || p.last_name as name, c.version_number, c.effective_from, c.effective_to,
             c.base_salary, c.currency, c.payment_frequency, c.hourly_rate,
             (select count(*) from public.compensation_lines cl where cl.compensation_profile_id = c.id) as line_count
        from public.compensation_profiles c join public.personnel p on p.id = c.personnel_id
       where p_personnel_id is null or c.personnel_id = p_personnel_id
       order by p.personnel_number, c.version_number desc
       limit 2000) q;
  return jsonb_build_object('rows', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- Audit one export (report key + row count only — no filters, no names, no amounts).
-- ---------------------------------------------------------------------
create or replace function public.record_report_export(p_report text, p_rows integer)
returns void
language plpgsql security definer set search_path = public as $$
declare v_hr boolean := coalesce(p_report, '') like 'hr\_%' escape '\';
begin
  if p_report is null or p_report !~ '^[a-z][a-z0-9_]{2,63}$' then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  if v_hr then
    if not public.has_hr_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;
  perform public.write_log(case when v_hr then 'hr_reports' else 'payroll_reports' end, null, 'EXPORTED', null,
    jsonb_build_object('report', p_report, 'rows', greatest(coalesce(p_rows, 0), 0)));
end; $$;

-- ---------------------------------------------------------------------
-- activity_logs: CURRENT body (0131, verified by grep) + 'payroll_reports' (payroll access) + 'hr_reports' (HR access).
-- ---------------------------------------------------------------------
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records', 'hr_reports') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries',
                           'payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_work_inputs','payroll_calculations','payroll_results','payroll_result_lines',
                           'payroll_calc_warnings','payroll_accounting_settings','payroll_component_accounts',
                           'payroll_payments','payroll_payslips','payroll_reports') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
  and (entity_type not in ('journal_entries','journal_entry_lines','journal_entry',
                           'payments','payment','receipts','receipt') or public.has_accounting_access())
);

-- ---------------------------------------------------------------------
-- Grants: public report RPCs -> authenticated only; internal helper -> definer callers only.
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'payroll_dashboard(uuid)',
    'hr_payroll_gaps()',
    'payroll_report_register(uuid,text)',
    'payroll_report_by_period(integer,integer,integer,integer,text)',
    'payroll_report_personnel_options()',
    'payroll_report_by_personnel(uuid,integer,integer,integer,integer)',
    'payroll_report_components(uuid,text)',
    'payroll_report_payments(uuid,text,boolean)',
    'payroll_report_reconciliation(uuid)',
    'payroll_report_payslips(uuid)',
    'payroll_report_compensation_history(uuid)',
    'record_report_export(text,integer)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke execute on function public._payroll_report_base() from public, anon, authenticated';
end $$;

-- =====================================================================
-- ROLLBACK: drop the 12 functions above and public._payroll_report_base(); restore the 0131 p_logs_read body.
-- =====================================================================

-- =====================================================================
-- NIL Office — 0126_payroll_approval_read_rls.sql
-- HR & Payroll — Phase 4 — read RPCs (restated), RLS/grants for the 2 accounting-mapping tables,
-- p_logs_read restated from the CURRENT body (0123, verified by grep) + 2 new entity types + journal rows restricted to
-- accounting-access users (tg_audit leaks journal amounts otherwise), function grants.
--  * payroll_review_data (0122): + approved/accounting-link/sod info and approval_blockers (codes only).
--  * payroll_work_grid   (0122): + per-row `locked` (person has a result in an APPROVED batch of the period).
-- SELECT-only policies/grants (RLS-by-omission for writes). service_role: NOT granted.
-- =====================================================================

create or replace function public.payroll_review_data(p_batch_id uuid, p_large_change_pct numeric default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_p public.payroll_periods; v_prev_period public.payroll_periods; v_prev_calc uuid;
  v_stale text[]; v_crit_n integer; v_res_n integer; v_blockers jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_p from public.payroll_periods where id = v_b.period_id;

  select p2.* into v_prev_period
    from public.payroll_periods p2
    join public.payroll_batches b2 on b2.period_id = p2.id
   where b2.payroll_type = v_b.payroll_type and b2.currency = v_b.currency and b2.status <> 'CANCELLED'
     and b2.current_calculation_id is not null
     and (p2.jalali_year, p2.jalali_month) < (v_p.jalali_year, v_p.jalali_month)
   order by p2.jalali_year desc, p2.jalali_month desc limit 1;
  if found then
    select b2.current_calculation_id into v_prev_calc from public.payroll_batches b2
     where b2.period_id = v_prev_period.id and b2.payroll_type = v_b.payroll_type and b2.currency = v_b.currency
       and b2.status <> 'CANCELLED' and b2.current_calculation_id is not null;
  end if;

  -- Approval blockers (the approve RPC re-checks all of them): codes only.
  v_stale := public._payroll_batch_stale(p_batch_id);
  select count(*) into v_crit_n from public.payroll_calc_warnings w where w.calculation_id = v_b.current_calculation_id and w.severity = 'CRITICAL';
  select count(*) into v_res_n from public.payroll_results r where r.calculation_id = v_b.current_calculation_id;
  v_blockers := to_jsonb(array_remove(array[
    case when v_b.status = 'UNDER_REVIEW' and v_b.reviewed_at is null then 'NOT_REVIEWED' end,
    case when v_b.status = 'UNDER_REVIEW' and cardinality(v_stale) > 0 then 'STALE' end,
    case when v_b.status = 'UNDER_REVIEW' and v_crit_n > 0 then 'CRITICAL' end,
    case when v_b.status = 'UNDER_REVIEW' and v_res_n = 0 then 'EMPTY' end], null));

  return jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_b.id, 'batch_number', v_b.batch_number, 'status', v_b.status, 'currency', v_b.currency,
      'jurisdiction', v_b.jurisdiction, 'rounding_scale', v_b.rounding_scale, 'rounding_mode', v_b.rounding_mode,
      'calculation_version', v_b.calculation_version, 'calculated_at', v_b.calculated_at, 'calculated_by', v_b.calculated_by,
      'submitted_at', v_b.submitted_at, 'reviewed_at', v_b.reviewed_at, 'reviewed_by', v_b.reviewed_by,
      'status_note', v_b.status_note, 'notes', v_b.notes,
      'submitted_by', v_b.submitted_by, 'approved_at', v_b.approved_at, 'approved_by', v_b.approved_by,
      'accounting_journal_entry_id', v_b.accounting_journal_entry_id),
    'approval_blockers', v_blockers,
    'sod', jsonb_build_object(
      'reviewer_is_submitter', v_b.reviewed_by is not null and v_b.reviewed_by is not distinct from v_b.submitted_by,
      'approver_is_submitter', v_b.approved_by is not null and v_b.approved_by is not distinct from v_b.submitted_by,
      'approver_is_reviewer',  v_b.approved_by is not null and v_b.approved_by is not distinct from v_b.reviewed_by),
    'period', jsonb_build_object('id', v_p.id, 'jalali_year', v_p.jalali_year, 'jalali_month', v_p.jalali_month,
                                 'period_start', v_p.period_start, 'period_end', v_p.period_end),
    'previous_period', case when v_prev_period.id is null then null
                            else jsonb_build_object('jalali_year', v_prev_period.jalali_year, 'jalali_month', v_prev_period.jalali_month) end,
    'stale', to_jsonb(v_stale),
    'totals', (select jsonb_build_object(
                 'personnel_count', count(*), 'gross', coalesce(sum(r.gross), 0)::text,
                 'deductions', coalesce(sum(r.total_deductions), 0)::text,
                 'employer_cost', coalesce(sum(r.employer_cost), 0)::text, 'net', coalesce(sum(r.net), 0)::text)
                 from public.payroll_results r where r.calculation_id = v_b.current_calculation_id),
    'critical_count', (select count(*) from public.payroll_calc_warnings w where w.calculation_id = v_b.current_calculation_id and w.severity = 'CRITICAL'),
    'warning_count',  (select count(*) from public.payroll_calc_warnings w where w.calculation_id = v_b.current_calculation_id and w.severity = 'WARNING'),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'result_id', r.id, 'personnel_id', r.personnel_id, 'personnel_number', r.personnel_number,
               'personnel_name', r.personnel_name, 'currency', r.currency,
               'gross', r.gross::text, 'deductions', r.total_deductions::text, 'employer_cost', r.employer_cost::text, 'net', r.net::text,
               'is_complete', r.is_complete, 'critical_count', r.critical_count, 'warning_count', r.warning_count,
               'prev_gross', pr.gross::text, 'prev_net', pr.net::text,
               'is_new', (v_prev_calc is not null and pr.id is null),
               'net_change_pct', case when pr.net is not null and pr.net > 0 then round((r.net - pr.net) / pr.net * 100, 2)::text end,
               'large_change', case when pr.net is not null and pr.net > 0
                                    then abs((r.net - pr.net) / pr.net * 100) >= p_large_change_pct else false end)
             order by r.personnel_number)
        from public.payroll_results r
        left join public.payroll_results pr on pr.calculation_id = v_prev_calc and pr.personnel_id = r.personnel_id
       where r.calculation_id = v_b.current_calculation_id), '[]'::jsonb),
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object('personnel_id', w.personnel_id, 'severity', w.severity, 'code', w.code,
                                          'component_code', w.component_code, 'rule_key', w.rule_key)
             order by case w.severity when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end, w.code, w.personnel_id)
        from public.payroll_calc_warnings w where w.calculation_id = v_b.current_calculation_id), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object('personnel_id', o.personnel_id, 'personnel_number', pe.personnel_number,
                                          'personnel_name', pe.first_name || ' ' || pe.last_name,
                                          'decision', o.decision, 'reason', o.reason, 'decided_at', o.decided_at)
             order by pe.personnel_number)
        from public.payroll_eligibility_overrides o join public.personnel pe on pe.id = o.personnel_id
       where o.batch_id = p_batch_id and o.decision <> 'AUTO'), '[]'::jsonb)
  );
end; $$;

create or replace function public.payroll_work_grid(p_period_id uuid, p_batch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'personnel_id', e.personnel_id, 'personnel_number', p.personnel_number, 'name', p.first_name || ' ' || p.last_name,
      'job_title', p.job_title, 'in_period', e.in_period, 'included', e.included, 'override', e.override_decision,
      'currency', e.currency, 'has_profile', e.profile_id is not null, 'partial_period', e.partial_period,
      'locked', exists (select 1 from public.payroll_results r2
                          join public.payroll_batches b2 on b2.id = r2.batch_id and b2.approved_calculation_id = r2.calculation_id
                         where b2.period_id = p_period_id and b2.status = 'APPROVED' and r2.personnel_id = e.personnel_id),
      'manual_components', (
        select coalesce(jsonb_agg(jsonb_build_object('component_id', sc.id, 'code', sc.code, 'name_fa', ver.name_fa)
                                  order by ver.display_order, sc.code), '[]'::jsonb)
          from public.compensation_lines cl
          join public.salary_components sc on sc.id = cl.component_id
          join public.salary_component_versions ver on ver.id = cl.component_version_id
         where cl.compensation_profile_id = e.profile_id and ver.calculation_method = 'MANUAL_INPUT'),
      'work_data', (
        select jsonb_build_object('id', wd.id, 'revision', wd.revision, 'work_days', wd.work_days::text, 'work_hours', wd.work_hours::text,
                 'overtime_hours', wd.overtime_hours::text, 'absence_days', wd.absence_days::text, 'absence_hours', wd.absence_hours::text,
                 'paid_leave_days', wd.paid_leave_days::text, 'unpaid_leave_days', wd.unpaid_leave_days::text,
                 'mission_days', wd.mission_days::text, 'mission_hours', wd.mission_hours::text, 'notes', wd.notes)
          from public.payroll_work_data wd where wd.period_id = p_period_id and wd.personnel_id = e.personnel_id),
      'inputs', (
        select coalesce(jsonb_object_agg(i.component_id::text, jsonb_build_object('amount', i.amount::text, 'currency', i.currency)), '{}'::jsonb)
          from public.payroll_work_inputs i join public.payroll_work_data wd2 on wd2.id = i.work_data_id
         where wd2.period_id = p_period_id and wd2.personnel_id = e.personnel_id)
    ) order by p.personnel_number)
    from public._payroll_eligibility(p_period_id, p_batch_id) e
    join public.personnel p on p.id = e.personnel_id), '[]'::jsonb);
end; $$;

alter table public.payroll_accounting_settings enable row level security;
alter table public.payroll_component_accounts  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['payroll_accounting_settings','payroll_component_accounts']
  loop
    execute format('drop policy if exists p_%1$s_read on public.%1$s;', t);
    execute format('create policy p_%1$s_read on public.%1$s for select using (public.has_payroll_access());', t);
    execute format('revoke all on public.%1$s from anon;', t);
    execute format('grant select on public.%1$s to authenticated;', t);   -- 0013 gotcha: explicit grant
  end loop;
end $$;

-- activity_logs: CURRENT body (0123) + Phase 4 entity types.
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries',
                           'payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_work_inputs','payroll_calculations','payroll_results','payroll_result_lines',
                           'payroll_calc_warnings','payroll_accounting_settings','payroll_component_accounts') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
  -- Phase 4: the generic tg_audit() (0019) copies WHOLE journal rows (debit/credit amounts) into activity_logs. Payroll now writes
  -- journal drafts, so those amounts must not be readable by every active user — accounting-access users only. (No UI reads these rows.)
  and (entity_type not in ('journal_entries','journal_entry_lines','journal_entry') or public.has_accounting_access())
);

-- Public RPCs (tier checks are inside each function) / internal helpers (callable only from the definer functions).
do $$
declare f text;
begin
  foreach f in array array[
    'approve_payroll_batch(uuid,text)',
    'reopen_payroll_batch(uuid,text)',
    'set_payroll_accounting_settings(uuid,uuid)',
    'set_payroll_component_accounts(uuid,uuid,uuid)',
    'payroll_accounting_accounts()',
    'payroll_accounting_readiness(uuid)',
    'create_payroll_accounting_draft(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    '_payroll_live_journal(uuid)',
    '_payroll_account_ok(uuid)',
    '_payroll_journal_lines(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK: re-run 0122 (payroll_review_data, payroll_work_grid) and restore the 0123 p_logs_read body;
--   revoke select on the 2 tables from authenticated; drop their p_*_read policies; disable RLS.
-- =====================================================================

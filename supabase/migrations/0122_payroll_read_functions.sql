-- =====================================================================
-- NIL Office — 0122_payroll_read_functions.sql
-- HR & Payroll — Phase 3 — read RPCs. STABLE SECURITY DEFINER, has_payroll_access() FIRST.
-- Every amount leaves the DB as TEXT (numeric(20,4)::text) — no float, no browser arithmetic.
-- Previous-period comparison is computed HERE at read time (nothing stored); it only highlights, never rejects.
-- =====================================================================

create or replace function public.payroll_review_data(p_batch_id uuid, p_large_change_pct numeric default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_p public.payroll_periods; v_prev_period public.payroll_periods; v_prev_calc uuid;
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

  return jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_b.id, 'batch_number', v_b.batch_number, 'status', v_b.status, 'currency', v_b.currency,
      'jurisdiction', v_b.jurisdiction, 'rounding_scale', v_b.rounding_scale, 'rounding_mode', v_b.rounding_mode,
      'calculation_version', v_b.calculation_version, 'calculated_at', v_b.calculated_at, 'calculated_by', v_b.calculated_by,
      'submitted_at', v_b.submitted_at, 'reviewed_at', v_b.reviewed_at, 'reviewed_by', v_b.reviewed_by,
      'status_note', v_b.status_note, 'notes', v_b.notes),
    'period', jsonb_build_object('id', v_p.id, 'jalali_year', v_p.jalali_year, 'jalali_month', v_p.jalali_month,
                                 'period_start', v_p.period_start, 'period_end', v_p.period_end),
    'previous_period', case when v_prev_period.id is null then null
                            else jsonb_build_object('jalali_year', v_prev_period.jalali_year, 'jalali_month', v_prev_period.jalali_month) end,
    'stale', to_jsonb(public._payroll_batch_stale(p_batch_id)),
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

create or replace function public.payroll_result_detail(p_result_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_r public.payroll_results;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_r from public.payroll_results where id = p_result_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'result', jsonb_build_object(
      'id', v_r.id, 'batch_id', v_r.batch_id, 'calculation_id', v_r.calculation_id, 'personnel_id', v_r.personnel_id,
      'personnel_number', v_r.personnel_number, 'personnel_name', v_r.personnel_name, 'currency', v_r.currency,
      'gross', v_r.gross::text, 'total_deductions', v_r.total_deductions::text, 'employer_cost', v_r.employer_cost::text,
      'net', v_r.net::text, 'is_complete', v_r.is_complete, 'compensation_version_number', v_r.compensation_version_number,
      'inputs', v_r.inputs,
      'calculation_version', (select c.calculation_version from public.payroll_calculations c where c.id = v_r.calculation_id),
      'is_current', exists (select 1 from public.payroll_batches b where b.id = v_r.batch_id and b.current_calculation_id = v_r.calculation_id)),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_order', l.line_order, 'component_code', l.component_code, 'component_name_fa', l.component_name_fa,
               'component_type', l.component_type, 'method', l.method, 'status', l.status, 'amount', l.amount::text,
               'amount_source', l.amount_source, 'basis', l.basis, 'base_amount', l.base_amount::text, 'rate', l.rate::text,
               'rate_source', l.rate_source, 'rule_key', l.rule_key,
               'rule_set_label', (select s.name || ' / نسخه ' || s.version_number from public.legal_rule_sets s where s.id = l.rule_set_id),
               'taxable', l.taxable, 'insurable', l.insurable) order by l.line_order)
        from public.payroll_result_lines l where l.result_id = v_r.id), '[]'::jsonb),
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object('severity', w.severity, 'code', w.code, 'component_code', w.component_code, 'rule_key', w.rule_key)
             order by case w.severity when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end, w.code)
        from public.payroll_calc_warnings w where w.calculation_id = v_r.calculation_id and w.personnel_id = v_r.personnel_id), '[]'::jsonb)
  );
end; $$;

-- Work-data grid for a period (optionally with a batch: adds included/override). Names are minimal PII for payroll users.
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

-- =====================================================================
-- ROLLBACK: drop function if exists public.payroll_work_grid(uuid,uuid), public.payroll_result_detail(uuid), public.payroll_review_data(uuid,numeric);
-- =====================================================================

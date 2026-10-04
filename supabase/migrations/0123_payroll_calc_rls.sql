-- =====================================================================
-- NIL Office — 0123_payroll_calc_rls.sql
-- HR & Payroll — Phase 3 — RLS + grants + function grants + activity_logs.
-- SELECT-only policies/grants (RLS-by-omission for writes, as 0117). service_role: NOT granted.
-- =====================================================================
alter table public.payroll_periods              enable row level security;
alter table public.payroll_batches              enable row level security;
alter table public.payroll_batch_transitions    enable row level security;
alter table public.payroll_eligibility_overrides enable row level security;
alter table public.payroll_work_data            enable row level security;
alter table public.payroll_work_inputs          enable row level security;
alter table public.payroll_calculations         enable row level security;
alter table public.payroll_results              enable row level security;
alter table public.payroll_result_lines         enable row level security;
alter table public.payroll_calc_warnings        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['payroll_periods','payroll_batches','payroll_batch_transitions','payroll_eligibility_overrides',
                           'payroll_work_data','payroll_work_inputs','payroll_calculations','payroll_results',
                           'payroll_result_lines','payroll_calc_warnings']
  loop
    execute format('drop policy if exists p_%1$s_read on public.%1$s;', t);
    execute format('create policy p_%1$s_read on public.%1$s for select using (public.has_payroll_access());', t);
    execute format('revoke all on public.%1$s from anon;', t);
    execute format('grant select on public.%1$s to authenticated;', t);   -- 0013 gotcha: explicit grant
  end loop;
end $$;

-- activity_logs: CURRENT body (0117) + Phase 3 entity types (verified: only 0004/0113/0117 define p_logs_read).
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries',
                           'payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_work_inputs','payroll_calculations','payroll_results','payroll_result_lines',
                           'payroll_calc_warnings') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
);

-- Public RPCs: not PUBLIC/anon, yes authenticated (tier checks are inside each function).
do $$
declare f text;
begin
  foreach f in array array[
    'create_payroll_period(integer,integer,date,date)',
    'save_payroll_work_data(uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb,text)',
    'save_payroll_work_data_rows(uuid,jsonb)',
    'create_payroll_batch(uuid,text,integer,text,text,text,text)',
    'update_payroll_batch_settings(uuid,text,integer,text)',
    'set_payroll_eligibility_override(uuid,uuid,text,text)',
    'calculate_payroll_batch(uuid)',
    'change_payroll_batch_status(uuid,text,text)',
    'mark_payroll_batch_reviewed(uuid)',
    'payroll_review_data(uuid,numeric)',
    'payroll_result_detail(uuid)',
    'payroll_work_grid(uuid,uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Internal helpers: callable only from the definer functions above.
  foreach f in array array[
    '_payroll_round(numeric,integer,text)',
    '_payroll_add_warning(uuid,uuid,uuid,text,text,text,text)',
    '_payroll_profile_on(uuid,date)',
    '_payroll_resolve_rule(text,text,date)',
    '_payroll_rule_for_period(text,text,date,date)',
    '_payroll_eligibility(uuid,uuid)',
    '_payroll_calc_personnel(uuid,uuid,uuid,text,boolean,boolean)',
    '_payroll_batch_stale(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK
-- drop policy if exists p_logs_read on public.activity_logs;  -- then re-create the 0117 body (without the 9 payroll_* entity types)
-- revoke select on the 10 tables from authenticated; drop their p_*_read policies; alter table ... disable row level security;
-- =====================================================================
